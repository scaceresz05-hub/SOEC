import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService, EceQueryService } from '@soec/ece';
import { MecanismoDeterministico, MecanismoSimuladoIA, OperacionesService } from '@soec/operaciones';
import { CapabilitiesOrchestrator, CapabilityQueryService, CapabilityRegistry } from '@soec/capacidades';

export const attr: Attribution = {
  source: 'instancia-pyme-sintetica',
  purpose: 'F1-RM-01 primer dominio',
  assumptions: ['pyme sintética; ningún dato real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
export const seedOpts = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

export function ctxFor(org: string, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('responsable'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function cadena(store: EventStore) {
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const eceQuery = new EceQueryService(store, med, mdm);
  const operaciones = new OperacionesService(store, eceQuery, [new MecanismoDeterministico(), new MecanismoSimuladoIA()]);
  const registry = new CapabilityRegistry(store);
  return {
    med,
    mdm,
    eceBuild: new EceBuildService(store, med, mdm),
    eceQuery,
    operaciones,
    registry,
    orchestrator: new CapabilitiesOrchestrator(store, registry, operaciones),
    capQuery: new CapabilityQueryService(store),
  };
}
