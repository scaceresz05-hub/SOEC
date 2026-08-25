/**
 * apps/api · campana · INGESTA de EVIDENCIA DE DIAGNÓSTICO (event-sourced, last-wins, por organización).
 *
 * Vía SOPORTADA y AUDITABLE para registrar el resultado del diagnóstico/remediación del funnel (hecho fuera
 * de SOEC) y que el Campaign Operator lo consuma. Reutiliza el event store; tenant-scoped; timestamped.
 * No ejecuta nada ni toca proveedores.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { MarketingReadiness } from './diagnosis-evidence';

export const EVENTO_READINESS = 'marketing-readiness.registrada';
export function readinessStreamId(org: string): string {
  return `marketing-readiness:${org}`;
}

const ATRIB: Attribution = {
  source: 'marketing-readiness',
  purpose: 'evidencia de diagnóstico del funnel (ingesta auditable)',
  assumptions: ['evidencia observacional registrada por una fuente externa; no es instrucción estratégica'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

export class DiagnosisEvidenceService {
  constructor(private readonly store: EventStore) {}

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('marketing-readiness'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `readiness-${org}` };
  }

  async registrar(org: string, readiness: MarketingReadiness, at: string): Promise<MarketingReadiness> {
    const ctx = this.ctx(org);
    const streamId = readinessStreamId(org);
    const eventos = await this.store.readStream(ctx, streamId);
    await this.store.append(ctx, streamId, eventos.length, [{ type: EVENTO_READINESS, payload: readiness, attribution: ATRIB, occurredAt: at }]).catch(() => undefined);
    return readiness;
  }

  async leerUltima(org: string): Promise<MarketingReadiness | null> {
    const ctx = this.ctx(org);
    const eventos = await this.store.readStream(ctx, readinessStreamId(org));
    let ultima: MarketingReadiness | null = null;
    for (const e of eventos) if (e.type === EVENTO_READINESS) ultima = e.payload as MarketingReadiness;
    return ultima;
  }
}
