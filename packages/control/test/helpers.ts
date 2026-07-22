import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { DecisionService, InboxService, PausaService } from '../src';

export const attr: Attribution = { source: 'control-test', purpose: 'gobernar', assumptions: ['sintético'], claimType: 'observational', regime: 'institutional', uncertainty: 'baja' };
export const now = '2026-07-21T09:00:00.000Z';

export function ctxFor(org = 'orgA', permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function montar(store: EventStore = new InMemoryEventStore()) {
  return { store, pausa: new PausaService(store), decisiones: new DecisionService(store), inbox: new InboxService(store) };
}
