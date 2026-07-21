import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { makePool, migrations as baseMigrations, runMigrations } from '@soec/event-store/pg';
import { PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { MedService, MdmService, ModelRepository } from '../../src/app/services';
import { modelMigrations } from '../../src/pg/migrations';
import { PgProjectionStore } from '../../src/pg/projection-store';
import { drenarProyecciones, reconstruirProyecciones } from '../../src/pg/projection-runner';
import { ambitoMed, ambitoMdm, attr, ctxFor, sleep, vigencia } from '../helpers';

const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);
const med = new MedService(store);
const mdm = new MdmService(store);
const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

beforeAll(async () => {
  await runMigrations(pool, [...baseMigrations, ...modelMigrations]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query('truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current restart identity cascade');
});

describe('Modelos sobre PostgreSQL real', () => {
  it('MED: persiste, incorpora evidencia, revisa y relee', async () => {
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base });
    await med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: { nombre: 'Ops' }, ...base });
    await med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'u1 ejecuta P', dimension: 'hace', incertidumbre: 'media', ...base });
    await med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'e1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'bitácora', contenido: 'ok', ...base });
    await med.revisarAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'suficiente', ...base });

    const st = await med.estadoActual(ctx, 'm1');
    expect(st.entidades['u1']?.atributos).toEqual({ nombre: 'Ops' });
    expect(st.afirmaciones['a1']?.estado).toBe('respaldada');
    expect(st.afirmaciones['a1']?.atribucion.source).toBe('fixture-sintetico');
    expect(st.version).toBe(5);
  });

  it('historia: reconstrucción temporal a un corte anterior', async () => {
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base });
    const r = await med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });
    const corte = r.events[r.events.length - 1]!.recordedAt;
    await sleep(15);
    await med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u2', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });

    const pasado = await med.estadoHistorico(ctx, 'm1', corte);
    expect(Object.keys(pasado.entidades)).toEqual(['u1']);
    const presente = await med.estadoActual(ctx, 'm1');
    expect(Object.keys(presente.entidades).sort()).toEqual(['u1', 'u2']);
  });

  it('concurrencia optimista: versión obsoleta → ConcurrencyError', async () => {
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base });
    const repo = new ModelRepository(store);
    await expect(
      repo.emitir(ctx, 'MED', 'm1', 0, {
        type: 'med.entidad_registrada',
        payload: { entidadId: 'x', dimension: 'es', tipo: 'unidad', atributos: {} },
        attribution: attr,
        occurredAt: base.occurredAt,
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('idempotencia: la misma clave no duplica', async () => {
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base });
    const cmd = { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, idempotencyKey: 'k1', ...base };
    await med.registrarEntidad(ctx, cmd);
    await med.registrarEntidad(ctx, cmd);
    const st = await med.estadoActual(ctx, 'm1');
    expect(Object.keys(st.entidades)).toEqual(['u1']);
    expect(st.version).toBe(2);
  });

  it('aislamiento organizacional y separación MED ╪ MDM', async () => {
    const a = ctxFor('orgA');
    const b = ctxFor('orgB');
    await med.crear(a, { instanceId: 'x', ambito: ambitoMed, vigencia, ...base });
    await med.registrarEntidad(a, { instanceId: 'x', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });
    await mdm.crear(a, { instanceId: 'x', ambito: ambitoMdm, vigencia, ...base });
    await mdm.registrarObservacion(a, { instanceId: 'x', observacionId: 'o1', contenido: 'entorno', ...base });

    // Otra organización no ve nada.
    expect((await med.estadoActual(b, 'x')).existe).toBe(false);
    // MED y MDM con misma id no se contaminan.
    const medX = await med.estadoActual(a, 'x');
    const mdmX = await mdm.estadoActual(a, 'x');
    expect(Object.keys(medX.entidades)).toEqual(['u1']);
    expect(medX.observaciones).toHaveLength(0);
    expect(mdmX.observaciones).toHaveLength(1);
    expect(Object.keys(mdmX.entidades)).toEqual([]);
  });

  it('proyecciones: worker drena el outbox; reconstruir desde cero da el mismo resultado', async () => {
    const a = ctxFor('orgA');
    await med.crear(a, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base });
    await med.registrarEntidad(a, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: { nombre: 'Ops' }, ...base });
    await mdm.crear(a, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...base });
    await mdm.registrarObservacion(a, { instanceId: 'w1', observacionId: 'o1', contenido: 'obs', ...base });

    const outbox = new PgOutbox(pool);
    const proj = new PgProjectionStore(pool);
    const n = await drenarProyecciones(outbox, proj, 100);
    expect(n).toBe(4);
    // Segundo drenaje: el outbox ya está procesado → nada nuevo.
    expect(await drenarProyecciones(outbox, proj, 100)).toBe(0);

    const medPorWorker = (await proj.list('MED', 'orgA'))[0];
    const medAgg = await med.estadoActual(a, 'm1');
    expect(medPorWorker).toEqual(medAgg);
    expect((await proj.list('MDM', 'orgA'))[0]?.observaciones).toHaveLength(1);

    // Reconstrucción desde cero (borra y rehace desde la historia): idéntica.
    const antesMed = (await proj.list('MED', 'orgA'))[0];
    const antesMdm = (await proj.list('MDM', 'orgA'))[0];
    const reconstruidas = await reconstruirProyecciones(pool);
    expect(reconstruidas).toBe(2);
    expect((await proj.list('MED', 'orgA'))[0]).toEqual(antesMed);
    expect((await proj.list('MDM', 'orgA'))[0]).toEqual(antesMdm);
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, [...baseMigrations, ...modelMigrations]);
    expect(applied).toEqual([]);
  });
});
