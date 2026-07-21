import { ActorId, type Attribution, OrganizationId, type RequestContext } from '@soec/contracts';
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService } from '../src/app/build-service';
import { EceQueryService } from '../src/app/read-port';

export const attr: Attribution = {
  source: 'fixture-sintetico',
  purpose: 'prueba F1-ECE-01',
  assumptions: ['dato sintético; ninguna empresa real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

export function ctxFor(
  org: string,
  permissions: string[] = ['events:append', 'events:read'],
): RequestContext {
  const organizationId = OrganizationId(org);
  return {
    organizationId,
    actor: ActorId('tester'),
    scope: { organizationId, permissions },
    correlationId: `corr-${org}`,
  };
}

export const nowIso = (): string => new Date().toISOString();
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const ambitoMed = {
  proposito: 'representar la estructura de una organización sintética',
  representa: 'procesos y ofertas declarados',
  excluye: 'el entorno de mercado (eso es el MDM)',
  supuestos: ['fixture sin sector fijado'],
};
export const ambitoMdm = {
  proposito: 'representar el entorno relevante',
  representa: 'normas y actores externos',
  excluye: 'la configuración interna (eso es el MED)',
  supuestos: ['acceso mediado'],
};
export const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

export interface Entorno {
  store: InMemoryEventStore;
  clock: FixedClock;
  med: MedService;
  mdm: MdmService;
  build: EceBuildService;
  query: EceQueryService;
}

export function entorno(): Entorno {
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const store = new InMemoryEventStore(clock);
  const med = new MedService(store);
  const mdm = new MdmService(store);
  return { store, clock, med, mdm, build: new EceBuildService(store, med, mdm), query: new EceQueryService(store, med, mdm) };
}

export const cmdBase = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };
