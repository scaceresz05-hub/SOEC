import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import {
  ContentService,
  MarcaService,
  PromptService,
  ProveedorGenerativoDeterminista,
  paqueteStreamId,
} from '../../src';
import {
  contenidoMigrations,
  PgBriefProjectionStore,
  PgPaqueteProjectionStore,
  drenarContenido,
  reconstruirProyeccionesContenido,
} from '../../src/pg';
import {
  CONT_GANCHOS,
  IDS_CONT,
  IDS_MKT_CONT,
  marcaDemo,
  objetivoContenidoDemo,
  optsContenidoDemo,
  politicaContenidoDemo,
  promptAdaptDemo,
  promptPiezaDemo,
} from '../../src/fixtures';
import { attr, ctxFor, fechaInicio, now } from '../helpers';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const CADENA = [
  ...migracionesHastaCapacidades,
  ...operacionalMigrations,
  ...marketingMigrations,
  ...contenidoMigrations,
];
const pool = makeTestPool();
const store = new PgEventStore(pool);
const operational = new OperationalService(store, [new AdaptadorSimulado()]);
const planning = new PlanningService(store, operational);
const policies = new PolicyService(store);
const objetivos = new ObjectiveService(store);
const marcas = new MarcaService(store);
const prompts = new PromptService(store);
const content = new ContentService(store, new ProveedorGenerativoDeterminista(), planning);

const PLAN = IDS_MKT_CONT.plan;
const actBlog = 'act-blog-0';

beforeAll(async () => {
  await runMigrations(pool, CADENA);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(
    pool,
    `truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current,
       proj_capdef_current, proj_capexec_current, proj_policy_current, proj_accion_current, proj_objetivo_current, proj_plan_current,
       proj_brief_current, proj_paquete_current
     restart identity cascade`,
  );
});

async function sembrar(ctx = ctxFor('orgA')) {
  const rm = await marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, attr, now);
  await marcas.publicar(ctx, IDS_CONT.marca, rm.version, attr, now);
  const rp1 = await prompts.registrarVersion(ctx, IDS_CONT.promptPieza, promptPiezaDemo, attr, now);
  await prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, attr, now);
  const rp2 = await prompts.registrarVersion(ctx, IDS_CONT.promptAdapt, promptAdaptDemo, attr, now);
  await prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, attr, now);
  await objetivos.registrar(ctx, IDS_MKT_CONT.objetivo, objetivoContenidoDemo, attr, now);
  const rpol = await policies.registrarVersion(
    ctx,
    IDS_MKT_CONT.politica,
    politicaContenidoDemo,
    attr,
    now,
  );
  await policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, attr, now);
  await planning.generarPlan(ctx, {
    planId: PLAN,
    objetivoId: IDS_MKT_CONT.objetivo,
    policyId: IDS_MKT_CONT.politica,
    fechaInicio,
    opts: optsContenidoDemo,
    attribution: attr,
    occurredAt: now,
  });
  return ctx;
}

function cmd(actividadId: string) {
  return {
    planId: PLAN,
    actividadId,
    marcaId: IDS_CONT.marca,
    promptPiezaId: IDS_CONT.promptPieza,
    promptAdaptId: IDS_CONT.promptAdapt,
    ganchosPromocionales: CONT_GANCHOS,
    attribution: attr,
    occurredAt: now,
  };
}

describe('Fábrica de contenido sobre PostgreSQL real', () => {
  it('produce y persiste un paquete listo; desbloquea la actividad', async () => {
    const ctx = await sembrar();
    const r = await content.prepararContenidoParaActividad(ctx, cmd(actBlog));
    expect(r.actividadDesbloqueada).toBe(true);
    const paquete = await content.cargarPaquete(ctx, `${PLAN}--${actBlog}`);
    expect(paquete.estado).toBe('autorizado');
    expect((await planning.cargar(ctx, PLAN)).actividades[actBlog]?.estado).toBe('autorizable');
  });

  it('ejecuta por el plano operacional (simulado) y verifica el paquete', async () => {
    const ctx = await sembrar();
    await content.prepararContenidoParaActividad(ctx, cmd(actBlog));
    const e = await planning.ejecutarSiguiente(ctx, PLAN, attr, now);
    expect(e.permitida).toBe(true);
    const paquete = await content.registrarEjecucion(ctx, `${PLAN}--${e.actividad}`, {
      permitida: e.permitida,
      resultado: e.resultado,
      executionRef: `${PLAN}:${e.actividad}`,
      attribution: attr,
      occurredAt: now,
    });
    expect(paquete.estado).toBe('verificado');
  });

  it('worker: proyecta briefs y paquetes; reconstruye desde cero idéntico', async () => {
    const ctx = await sembrar();
    await content.prepararContenidoParaActividad(ctx, cmd(actBlog));
    const outbox = new PgOutbox(pool);
    const stores = {
      brief: new PgBriefProjectionStore(pool),
      paquete: new PgPaqueteProjectionStore(pool),
    };
    const n = await drenarContenido(outbox, stores);
    expect(n).toBeGreaterThan(0);
    expect((await stores.paquete.list('orgA')).length).toBeGreaterThan(0);
    const antes = await stores.paquete.list('orgA');
    await reconstruirProyeccionesContenido(pool);
    expect(await stores.paquete.list('orgA')).toEqual(antes);
  });

  it('concurrencia optimista sobre el stream del paquete', async () => {
    const ctx = await sembrar();
    await content.prepararContenidoParaActividad(ctx, cmd(actBlog));
    await expect(
      store.append(ctx, paqueteStreamId(`${PLAN}--${actBlog}`), 0, [
        { type: 'paq.retirado', payload: { motivo: 'x' }, attribution: attr, occurredAt: now },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('es idempotente por identidad de paquete y aísla por organización', async () => {
    const ctx = await sembrar();
    const r1 = await content.prepararContenidoParaActividad(ctx, cmd(actBlog));
    const r2 = await content.prepararContenidoParaActividad(ctx, cmd(actBlog));
    expect(r2.paquete.version).toBe(r1.paquete.version);
    expect((await content.cargarPaquete(ctxFor('orgB'), `${PLAN}--${actBlog}`)).existe).toBe(false);
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, CADENA);
    expect(applied).toEqual([]);
  });
});
