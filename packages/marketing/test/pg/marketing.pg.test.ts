import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '../../src';
import { objStreamId } from '../../src/domain/objetivo';
import { IDS_DEMO, objetivoDemo, optsDemo, politicaDemo } from '../../src/fixtures';
import {
  marketingMigrations,
  PgObjetivoProjectionStore,
  PgPlanProjectionStore,
  drenarMarketing,
  reconstruirProyeccionesMarketing,
} from '../../src/pg';
import { attr, ctxFor, fechaInicio, now } from '../helpers';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const pool = makeTestPool();
const store = new PgEventStore(pool);
const operational = new OperationalService(store, [new AdaptadorSimulado()]);
const policies = new PolicyService(store);
const objetivos = new ObjectiveService(store);
const planning = new PlanningService(store, operational);

beforeAll(async () => {
  await runMigrations(pool, [
    ...migracionesHastaCapacidades,
    ...operacionalMigrations,
    ...marketingMigrations,
  ]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(
    pool,
    `truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current,
       proj_capdef_current, proj_capexec_current, proj_policy_current, proj_accion_current, proj_objetivo_current, proj_plan_current
     restart identity cascade`,
  );
});

async function sembrar(ctx = ctxFor('orgA')) {
  await objetivos.registrar(ctx, IDS_DEMO.objetivo, objetivoDemo, attr, now);
  const rp = await policies.registrarVersion(ctx, IDS_DEMO.politica, politicaDemo, attr, now);
  await policies.publicar(ctx, IDS_DEMO.politica, rp.version, attr, now);
  await planning.generarPlan(ctx, {
    planId: IDS_DEMO.plan,
    objetivoId: IDS_DEMO.objetivo,
    policyId: IDS_DEMO.politica,
    fechaInicio,
    opts: optsDemo,
    attribution: attr,
    occurredAt: now,
  });
  return ctx;
}

describe('Marketing sobre PostgreSQL real', () => {
  it('planifica, persiste y ejecuta la próxima acción (autorizada, efecto simulado)', async () => {
    const ctx = await sembrar();
    const plan = await planning.cargar(ctx, IDS_DEMO.plan);
    expect(plan.planVersion).toBe(1);
    const r = await planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now);
    expect(r.permitida).toBe(true);
    const relee = await planning.cargar(ctx, IDS_DEMO.plan);
    expect(Object.values(relee.actividades).some((a) => a.estado === 'verificada')).toBe(true);
  });

  it('concurrencia optimista sobre el stream del plan', async () => {
    const ctx = await sembrar();
    await expect(
      store.append(ctx, `plan:${IDS_DEMO.plan}`, 0, [
        { type: 'plan.pausado', payload: {}, attribution: attr, occurredAt: now },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('rechaza objetivos imposibles antes de persistir', async () => {
    const ctx = ctxFor('orgA');
    await expect(
      objetivos.registrar(ctx, 'obj-malo', { ...objetivoDemo, valorEsperado: 1 }, attr, now),
    ).rejects.toThrow();
    expect((await store.readStream(ctx, objStreamId('obj-malo'))).length).toBe(0);
  });

  it('aislamiento organizacional', async () => {
    await sembrar(ctxFor('orgA'));
    expect((await planning.cargar(ctxFor('orgB'), IDS_DEMO.plan)).existe).toBe(false);
  });

  it('worker: proyecta objetivos y planes; reconstruye desde cero idéntico', async () => {
    const ctx = await sembrar();
    await planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now);
    const outbox = new PgOutbox(pool);
    const stores = {
      objetivo: new PgObjetivoProjectionStore(pool),
      plan: new PgPlanProjectionStore(pool),
    };
    const n = await drenarMarketing(outbox, stores);
    expect(n).toBeGreaterThan(0);
    expect((await stores.plan.list('orgA'))[0]?.planVersion).toBe(1);
    const antes = await stores.plan.list('orgA');
    await reconstruirProyeccionesMarketing(pool);
    expect(await stores.plan.list('orgA')).toEqual(antes);
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, [
      ...migracionesHastaCapacidades,
      ...operacionalMigrations,
      ...marketingMigrations,
    ]);
    expect(applied).toEqual([]);
  });
});
