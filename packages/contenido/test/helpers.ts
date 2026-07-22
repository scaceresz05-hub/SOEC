import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import {
  ContentService,
  MarcaService,
  PromptService,
  ProveedorGenerativoDeterminista,
} from '../src';
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
} from '../src/fixtures';

export const attr: Attribution = {
  source: 'fabrica-contenido',
  purpose: 'producir contenido de marketing autorizado por política',
  assumptions: ['estrategia sintética; efectos simulados; proveedor determinista (no IA real)'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};
export const now = '2026-03-02T09:00:00.000Z'; // lunes
export const fechaInicio = '2026-03-02T09:00:00.000Z';
export { CONT_GANCHOS, IDS_CONT, IDS_MKT_CONT };

export function ctxFor(org: string, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function montar(store: EventStore = new InMemoryEventStore()) {
  const operational = new OperationalService(store, [new AdaptadorSimulado()]);
  const planning = new PlanningService(store, operational);
  return {
    store,
    operational,
    planning,
    policies: new PolicyService(store),
    objetivos: new ObjectiveService(store),
    marcas: new MarcaService(store),
    prompts: new PromptService(store),
    content: new ContentService(store, new ProveedorGenerativoDeterminista(), planning),
  };
}

/** Siembra marca + prompts + objetivo + política + plan (campañas sin contenido). */
export async function sembrar(m: ReturnType<typeof montar>, ctx = ctxFor('orgA')) {
  const rm = await m.marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, attr, now);
  await m.marcas.publicar(ctx, IDS_CONT.marca, rm.version, attr, now);
  const rp1 = await m.prompts.registrarVersion(ctx, IDS_CONT.promptPieza, promptPiezaDemo, attr, now);
  await m.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, attr, now);
  const rp2 = await m.prompts.registrarVersion(ctx, IDS_CONT.promptAdapt, promptAdaptDemo, attr, now);
  await m.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, attr, now);
  await m.objetivos.registrar(ctx, IDS_MKT_CONT.objetivo, objetivoContenidoDemo, attr, now);
  const rpol = await m.policies.registrarVersion(ctx, IDS_MKT_CONT.politica, politicaContenidoDemo, attr, now);
  await m.policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, attr, now);
  const plan = await m.planning.generarPlan(ctx, {
    planId: IDS_MKT_CONT.plan,
    objetivoId: IDS_MKT_CONT.objetivo,
    policyId: IDS_MKT_CONT.politica,
    fechaInicio,
    opts: optsContenidoDemo,
    attribution: attr,
    occurredAt: now,
  });
  return { ctx, plan };
}

export function prepararCmd(actividadId: string, extra: Record<string, unknown> = {}) {
  return {
    planId: IDS_MKT_CONT.plan,
    actividadId,
    marcaId: IDS_CONT.marca,
    promptPiezaId: IDS_CONT.promptPieza,
    promptAdaptId: IDS_CONT.promptAdapt,
    ganchosPromocionales: CONT_GANCHOS,
    attribution: attr,
    occurredAt: now,
    ...extra,
  };
}
