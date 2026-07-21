import { ActorId, type Attribution, OrganizationId, type RequestContext } from '@soec/contracts';

export const attr: Attribution = {
  source: 'fixture-sintetico',
  purpose: 'prueba F1-MOD-01',
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
  representa: 'unidades, recursos y procesos declarados',
  excluye: 'el entorno de mercado (eso es el MDM)',
  supuestos: ['fixture sin sector fijado'],
};

export const ambitoMdm = {
  proposito: 'representar el entorno relevante de la organización',
  representa: 'normas, actores externos y su dinámica',
  excluye: 'la configuración interna de la empresa (eso es el MED)',
  supuestos: ['acceso mediado; evidencia más débil (#11 dif. 2)'],
};

export const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };
