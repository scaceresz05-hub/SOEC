import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '../src';
import { IDS_DEMO, objetivoDemo, optsDemo, politicaDemo } from '../src/fixtures';

export const attr: Attribution = {
  source: 'departamento-marketing',
  purpose: 'planificar y ejecutar marketing autorizado por política',
  assumptions: ['estrategia sintética; efectos simulados; ningún dato real'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};
export const now = '2026-03-02T09:00:00.000Z'; // lunes
export const fechaInicio = '2026-03-02T09:00:00.000Z';

export function ctxFor(org: string, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function montar(store: EventStore = new InMemoryEventStore()) {
  const operational = new OperationalService(store, [new AdaptadorSimulado()]);
  return {
    store,
    operational,
    policies: new PolicyService(store),
    objetivos: new ObjectiveService(store),
    planning: new PlanningService(store, operational),
  };
}

/** Registra objetivo + política vigente + genera el plan de la PyME sintética. */
export async function sembrarDemo(m: ReturnType<typeof montar>, ctx = ctxFor('orgA')) {
  await m.objetivos.registrar(ctx, IDS_DEMO.objetivo, objetivoDemo, attr, now);
  const rp = await m.policies.registrarVersion(ctx, IDS_DEMO.politica, politicaDemo, attr, now);
  await m.policies.publicar(ctx, IDS_DEMO.politica, rp.version, attr, now);
  const plan = await m.planning.generarPlan(ctx, {
    planId: IDS_DEMO.plan,
    objetivoId: IDS_DEMO.objetivo,
    policyId: IDS_DEMO.politica,
    fechaInicio,
    opts: optsDemo,
    attribution: attr,
    occurredAt: now,
  });
  return { ctx, plan };
}
