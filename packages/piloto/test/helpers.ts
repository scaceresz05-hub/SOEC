import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { EnsayoService, ExpedienteService, OrganizacionService, ReadinessService, ETAPAS, DATOS_ETAPAS, conexionDemoSandbox, identidadDemo, perfilDemo, presupuestoDemo } from '../src';

export const attr: Attribution = { source: 'piloto-test', purpose: 'preparar piloto', assumptions: ['sintético'], claimType: 'observational', regime: 'institutional', uncertainty: 'baja' };
export const now = '2026-07-21T09:00:00.000Z';
export { ETAPAS, DATOS_ETAPAS, conexionDemoSandbox, identidadDemo, perfilDemo, presupuestoDemo };

export function ctxFor(org = 'orgA', permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function montar(store: EventStore = new InMemoryEventStore()) {
  return { store, org: new OrganizacionService(store), readiness: new ReadinessService(store), exp: new ExpedienteService(store), ens: new EnsayoService(store) };
}

/** Registra la organización y completa todo el onboarding + perfil + presupuesto + conexión. */
export async function sembrarOrg(m: ReturnType<typeof montar>, orgId = 'org-1', ctx = ctxFor()) {
  await m.org.registrar(ctx, orgId, identidadDemo, ['marketing'], attr, now);
  for (const etapa of ETAPAS) await m.org.actualizarEtapa(ctx, orgId, etapa, 'completa', DATOS_ETAPAS[etapa], [], 'propietario', attr, now);
  await m.org.definirPerfil(ctx, orgId, perfilDemo, attr, now);
  await m.org.definirPresupuesto(ctx, orgId, presupuestoDemo, attr, now);
  await m.org.declararConexion(ctx, orgId, conexionDemoSandbox, attr, now);
  await m.org.aceptarPolitica(ctx, orgId, 1, attr, now);
  return ctx;
}
