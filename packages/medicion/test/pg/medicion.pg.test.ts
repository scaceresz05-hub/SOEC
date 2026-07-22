import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { makePool, runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { contenidoMigrations } from '@soec/contenido/pg';
import { canalesMigrations } from '@soec/canales/pg';
import { CRITERIO_DEMO, GASTO_AUTORIZADO_DEMO, POLICY_OPT_DEMO, medStreamId } from '../../src';
import { FuenteMetricasSimulada } from '../../src/app/metrics-source';
import { medicionMigrations, PgMedProjectionStore, PgOptProjectionStore, drenarMedicion, reconstruirProyeccionesMedicion } from '../../src/pg';
import { attr, ctxFor, filas, IDS_MKT_CONT, montar, now, sembrarYPublicar } from '../helpers';

const CADENA = [...migracionesHastaCapacidades, ...operacionalMigrations, ...marketingMigrations, ...contenidoMigrations, ...canalesMigrations, ...medicionMigrations];
const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);

function sinc(publicationId: string, externalRef: string, canal: string) {
  return { publicationId, externalRef, canal, cuenta: 'cuenta-demo', token: 't', campaniaRef: `cmp-${canal}`, objetivoRef: IDS_MKT_CONT.objetivo, criterio: CRITERIO_DEMO, gastoAutorizado: GASTO_AUTORIZADO_DEMO, muestraMinima: 500, attribution: attr, occurredAt: now };
}
function optc(publicationId: string, actividadId: string, canal: string) {
  return { publicationId, planId: IDS_MKT_CONT.plan, campaniaId: `cmp-${canal}`, actividadId, canal, objetivoId: IDS_MKT_CONT.objetivo, policyIdOperacional: IDS_MKT_CONT.politica, policyOpt: POLICY_OPT_DEMO, attribution: attr, occurredAt: now };
}

beforeAll(async () => {
  await runMigrations(pool, CADENA);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(
    `truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current,
       proj_capdef_current, proj_capexec_current, proj_policy_current, proj_accion_current, proj_objetivo_current, proj_plan_current,
       proj_brief_current, proj_paquete_current, proj_publicacion_current, proj_medicion_current, proj_optimizacion_current
     restart identity cascade`,
  );
});

describe('Medición y optimización sobre PostgreSQL real', () => {
  it('mide, evalúa, optimiza (pausa) y persiste el cambio versionado del plan', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(store, source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'bajo'));
    await m.medicion.sincronizar(ctx, sinc(publicationId, externalRef, 'blog'));
    const opt = await m.optimizacion.optimizar(ctx, optc(publicationId, 'act-blog-0', 'blog'));
    expect(opt.estado).toBe('aplicada');
    expect((await m.planning.cargar(ctx, IDS_MKT_CONT.plan)).actividades['act-blog-0']?.estado).toBe('omitida');
  });

  it('reevalúa con datos tardíos sin duplicar (corrección por secuencia)', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(store, source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'insuficiente', 1));
    await m.medicion.sincronizar(ctx, sinc(publicationId, externalRef, 'blog'));
    source.cargar(externalRef, filas(externalRef, 'alto', 2));
    const med = await m.medicion.sincronizar(ctx, sinc(publicationId, externalRef, 'blog'));
    expect(med.metricas.impresiones?.valor).toBe(1000);
    expect(med.evaluacion?.clasificacion).toBe('sobre_objetivo');
  });

  it('worker: proyecta medición y optimización; reconstruye desde cero idéntico', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(store, source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'bajo'));
    await m.medicion.sincronizar(ctx, sinc(publicationId, externalRef, 'blog'));
    await m.optimizacion.optimizar(ctx, optc(publicationId, 'act-blog-0', 'blog'));
    const outbox = new PgOutbox(pool);
    const stores = { medicion: new PgMedProjectionStore(pool), optimizacion: new PgOptProjectionStore(pool) };
    const n = await drenarMedicion(outbox, stores);
    expect(n).toBeGreaterThan(0);
    const antes = await stores.medicion.list(String(ctx.organizationId));
    expect(antes.length).toBeGreaterThan(0);
    await reconstruirProyeccionesMedicion(pool);
    expect(await stores.medicion.list(String(ctx.organizationId))).toEqual(antes);
  });

  it('concurrencia optimista, aislamiento y migración idempotente', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(store, source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'bajo'));
    await m.medicion.sincronizar(ctx, sinc(publicationId, externalRef, 'blog'));
    await expect(
      store.append(ctx, medStreamId(publicationId), 0, [{ type: 'med.sincronizado', payload: {}, attribution: attr, occurredAt: now }]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await m.medicion.cargar(ctxFor('otra-org'), publicationId)).existe).toBe(false);
    expect(await runMigrations(pool, CADENA)).toEqual([]);
  });
});
