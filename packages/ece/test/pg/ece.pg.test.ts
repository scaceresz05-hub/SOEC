import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { makePool, migrations as baseMigrations, runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { MedService, MdmService } from '@soec/models';
import { modelMigrations, PgProjectionStore } from '@soec/models/pg';
import { EceBuildService, EceQueryService } from '../../src';
import { eceStreamId } from '../../src/domain/ece';
import { eceMigrations, PgEceProjectionStore, drenarModelosYEce, reconstruirProyeccionesEce } from '../../src/pg';
import { ambitoMdm, ambitoMed, attr, cmdBase, ctxFor, sleep, vigencia } from '../helpers';

const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);
const med = new MedService(store);
const mdm = new MdmService(store);
const build = new EceBuildService(store, med, mdm);
const query = new EceQueryService(store, med, mdm);
const construir = { medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase };

beforeAll(async () => {
  await runMigrations(pool, [...baseMigrations, ...modelMigrations, ...eceMigrations]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(
    'truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current restart identity cascade',
  );
});

async function baseMedMdm(ctx = ctxFor('orgA')) {
  await med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
  await mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  return ctx;
}

describe('ECE sobre PostgreSQL real', () => {
  it('construye y persiste; relee elementos derivados', async () => {
    const ctx = await baseMedMdm();
    await build.construir(ctx, { eceId: 'ece1', ...construir });
    const st = await query.estadoActual(ctx, 'ece1');
    expect(st.existe).toBe(true);
    expect(Object.values(st.elementos).some((e) => e.tipo === 'ausencia' && e.noEvaluable)).toBe(true);
    expect(st.medCorte?.instanceId).toBe('m1');
  });

  it('historia: consulta a un corte anterior sin contaminación posterior', async () => {
    const ctx = await baseMedMdm();
    await build.construir(ctx, { eceId: 'ece1', ...construir });
    const corte = (await query.estadoActual(ctx, 'ece1')).construidoEn!;
    await sleep(15);
    await build.registrarElemento(ctx, {
      eceId: 'ece1',
      tipo: 'brecha',
      id: 'b1',
      referencias: [{ modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' }],
      procedencia: 'p',
      alcance: 'a',
      incertidumbre: 'media',
      ...cmdBase,
    });
    const pasado = await query.estadoEnFecha(ctx, 'ece1', corte);
    expect(pasado.elementos['b1']).toBeUndefined();
    expect((await query.estadoActual(ctx, 'ece1')).elementos['b1']).toBeDefined();
  });

  it('concurrencia optimista: versión obsoleta → ConcurrencyError', async () => {
    const ctx = await baseMedMdm();
    await build.construir(ctx, { eceId: 'ece1', ...construir });
    await expect(
      store.append(ctx, eceStreamId('ece1'), 0, [
        { type: 'ece.invalidado', payload: { motivo: 'x' }, attribution: attr, occurredAt: cmdBase.occurredAt },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('idempotencia: construir con la misma clave no duplica', async () => {
    const ctx = await baseMedMdm();
    await build.construir(ctx, { eceId: 'ece1', idempotencyKey: 'k1', ...construir });
    await build.construir(ctx, { eceId: 'ece1', idempotencyKey: 'k1', ...construir });
    expect((await query.estadoActual(ctx, 'ece1')).version).toBe(1);
  });

  it('aislamiento organizacional', async () => {
    await baseMedMdm(ctxFor('orgA'));
    await build.construir(ctxFor('orgA'), { eceId: 'ece1', ...construir });
    expect((await query.estadoActual(ctxFor('orgB'), 'ece1')).existe).toBe(false);
  });

  it('worker: proyecta el ECE, invalida por cambio de MED y reconstruye proyecciones desde cero', async () => {
    const ctx = await baseMedMdm();
    await build.construir(ctx, { eceId: 'ece1', ...construir });

    const outbox = new PgOutbox(pool);
    const modelProj = new PgProjectionStore(pool);
    const eceProj = new PgEceProjectionStore(pool);
    const deps = { eceProjStore: eceProj, build };

    // Drenaje inicial: proyecta MED, MDM y ECE.
    const r1 = await drenarModelosYEce(outbox, modelProj, deps);
    expect(r1.procesados).toBeGreaterThan(0);
    const projInicial = (await eceProj.list('orgA'))[0];
    expect(projInicial).toEqual(await query.estadoActual(ctx, 'ece1'));
    expect(projInicial?.vigente).toBe(true);

    // Cambio posterior en el MED → nuevo evento en el outbox.
    await med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...cmdBase });
    const r2 = await drenarModelosYEce(outbox, modelProj, deps);
    expect(r2.invalidaciones).toBe(1); // se emitió ece.invalidado (con causación)

    // El ece.invalidado quedó en el outbox → un drenaje más lo proyecta.
    await drenarModelosYEce(outbox, modelProj, deps);
    const projTrasCambio = (await eceProj.list('orgA'))[0];
    expect(projTrasCambio?.requiereReconstruccion).toBe(true);
    expect(projTrasCambio?.vigente).toBe(false);

    // Reconstrucción desde cero de las proyecciones del ECE: idéntica al agregado.
    const n = await reconstruirProyeccionesEce(pool);
    expect(n).toBe(1);
    expect((await eceProj.list('orgA'))[0]).toEqual(await query.estadoActual(ctx, 'ece1'));
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, [...baseMigrations, ...modelMigrations, ...eceMigrations]);
    expect(applied).toEqual([]);
  });
});
