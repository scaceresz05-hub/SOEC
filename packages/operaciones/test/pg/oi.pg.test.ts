import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { MedService, MdmService } from '@soec/models';
import { migracionesHastaEce } from '@soec/ece/pg';
import { EceBuildService, EceQueryService } from '@soec/ece';
import {
  MecanismoDeterministico,
  MecanismoSimuladoIA,
  OperacionesService,
  OperacionesQueryService,
} from '../../src';
import { oiStreamId } from '../../src/domain/aggregate';
import {
  oiMigrations,
  PgOiProjectionStore,
  drenarOperaciones,
  reconstruirProyeccionesOi,
} from '../../src/pg';
import { attr, ctxFor } from '../helpers';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const pool = makeTestPool();
const store = new PgEventStore(pool);
const med = new MedService(store);
const mdm = new MdmService(store);
const eceBuild = new EceBuildService(store, med, mdm);
const eceQuery = new EceQueryService(store, med, mdm);
const op = new OperacionesService(store, eceQuery, [
  new MecanismoDeterministico(),
  new MecanismoSimuladoIA(),
]);
const opQuery = new OperacionesQueryService(store);
const cmd = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };
const ambito = { proposito: 'p', representa: 'r', excluye: 'x', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

beforeAll(async () => {
  await runMigrations(pool, [...migracionesHastaEce, ...oiMigrations]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current restart identity cascade',
  );
});

async function eceConContradiccion(ctx = ctxFor('orgA')) {
  await med.crear(ctx, { instanceId: 'm1', ambito, vigencia, ...cmd });
  await med.emitirAfirmacion(ctx, {
    instanceId: 'm1',
    afirmacionId: 'a1',
    enunciado: 'x',
    dimension: 'hace',
    incertidumbre: 'media',
    ...cmd,
  });
  await med.incorporarEvidencia(ctx, {
    instanceId: 'm1',
    evidenciaId: 'a1-si',
    afirmacionId: 'a1',
    relacion: 'sostiene',
    procedencia: 'A',
    contenido: 'c',
    ...cmd,
  });
  await med.incorporarEvidencia(ctx, {
    instanceId: 'm1',
    evidenciaId: 'a1-no',
    afirmacionId: 'a1',
    relacion: 'debilita',
    procedencia: 'B',
    contenido: 'c',
    ...cmd,
  });
  await mdm.crear(ctx, { instanceId: 'w1', ambito, vigencia, ...cmd });
  await eceBuild.construir(ctx, {
    eceId: 'ece1',
    medInstanceId: 'm1',
    mdmInstanceId: 'w1',
    ...cmd,
  });
  return ctx;
}
const sol = (operacion: 'detectar' | 'orientar') => ({
  operacion,
  eceId: 'ece1',
  proposito: `p-${operacion}`,
  ...cmd,
});

describe('Operaciones sobre PostgreSQL real', () => {
  it('ejecuta, persiste y relee un producto', async () => {
    const ctx = await eceConContradiccion();
    const r = await op.ejecutar(ctx, 'x1', sol('detectar'));
    expect(r.producto.abstenido).toBe(false);
    const prod = await opQuery.producto(ctx, 'x1');
    expect(prod?.operacion).toBe('detectar');
    if (prod?.operacion === 'detectar') expect(prod.deteccion.senales.length).toBe(1);
    expect((await opQuery.ejecucion(ctx, 'x1')).estado).toBe('ejecutada');
  });

  it('concurrencia optimista sobre el stream de ejecución', async () => {
    const ctx = await eceConContradiccion();
    await op.ejecutar(ctx, 'x1', sol('detectar'));
    await expect(
      store.append(ctx, oiStreamId('x1'), 0, [
        { type: 'oi.solicitada', payload: {}, attribution: attr, occurredAt: cmd.occurredAt },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('idempotencia por identidad de ejecución', async () => {
    const ctx = await eceConContradiccion();
    const r1 = await op.ejecutar(ctx, 'x1', sol('detectar'));
    const r2 = await op.ejecutar(ctx, 'x1', sol('detectar'));
    expect(r2.state.version).toBe(r1.state.version);
  });

  it('aislamiento organizacional', async () => {
    await eceConContradiccion(ctxFor('orgA'));
    await op.ejecutar(ctxFor('orgA'), 'x1', sol('detectar'));
    expect((await opQuery.ejecucion(ctxFor('orgB'), 'x1')).existe).toBe(false);
  });

  it('no retroyección: el producto histórico no se recalcula al cambiar el ECE', async () => {
    const ctx = await eceConContradiccion();
    const r = await op.ejecutar(ctx, 'x1', sol('detectar'));
    const nOriginal =
      r.producto.operacion === 'detectar' ? r.producto.deteccion.senales.length : -1;
    // Cambia el ECE después.
    await med.emitirAfirmacion(ctx, {
      instanceId: 'm1',
      afirmacionId: 'a2',
      enunciado: 'y',
      dimension: 'hace',
      incertidumbre: 'media',
      ...cmd,
    });
    await eceBuild.construir(ctx, {
      eceId: 'ece1',
      medInstanceId: 'm1',
      mdmInstanceId: 'w1',
      ...cmd,
    });
    const prod = await opQuery.producto(ctx, 'x1');
    expect(prod?.operacion === 'detectar' && prod.deteccion.senales.length).toBe(nOriginal);
  });

  it('worker: proyecta las ejecuciones y reconstruye desde cero de forma idéntica', async () => {
    const ctx = await eceConContradiccion();
    await op.ejecutar(ctx, 'x1', sol('detectar'));
    await op.ejecutar(ctx, 'x2', sol('orientar'));

    const outbox = new PgOutbox(pool);
    const proj = new PgOiProjectionStore(pool);
    const n = await drenarOperaciones(outbox, proj);
    expect(n).toBeGreaterThan(0);
    expect(await drenarOperaciones(outbox, proj)).toBe(0); // idempotente: outbox procesado

    const x1 = (await proj.list('orgA')).find((s) => s.executionId === 'x1');
    expect(x1).toEqual(await opQuery.ejecucion(ctx, 'x1'));

    const antes = await proj.list('orgA');
    const rec = await reconstruirProyeccionesOi(pool);
    expect(rec).toBe(2);
    const despues = await proj.list('orgA');
    expect(despues.length).toBe(antes.length);
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, [...migracionesHastaEce, ...oiMigrations]);
    expect(applied).toEqual([]);
  });
});
