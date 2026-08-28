/**
 * apps/api · campana · COMPOSICIÓN del monitor de stops: cablea servicios EXISTENTES (envelope, bindings, ads
 * snapshot, readiness, contactos Growth) + el adapter PAUSE-ONLY en `DepsStopMonitor`. NO agrega lógica de negocio;
 * la ÚNICA capacidad de escritura que recibe el monitor es PAUSAR (nunca crear/habilitar/editar).
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { EnvelopeService } from './envelope-service';
import { ResourceBindingService } from './resource-binding';
import { DiagnosisEvidenceService } from './diagnosis-evidence-service';
import { adsSnapshotStreamId, ultimoSnapshotAds } from '../ingesta/ingesta-google-ads-service';
import type { GoogleAdsPauseAdapter } from './google-ads-pause-adapter';
import type { DepsStopMonitor, MetricasCampania, UltimoStop } from './stop-monitor';

const GROWTH = 'smileflow-growth';
const EVENTO_CONTACTO = 'lead_created';
export const EVENTO_STOP = 'stop-monitor.stop';
export function stopMonitorStreamId(org: string): string { return `stop-monitor:${org}`; }

const ATR: Attribution = { source: 'stop-monitor', purpose: 'pausa automática por regla de stop autorizada (reducción de riesgo)', assumptions: ['única acción provider = PAUSE; nunca create/enable/budget/targeting'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

/** `pausar` es opcional: sin adapter configurado el monitor decide pero no pausa (NO_PAUSE_ADAPTER, 0 writes). */
export function crearDepsStopMonitor(store: EventStore, pauseAdapter: GoogleAdsPauseAdapter | null): DepsStopMonitor {
  const ctx = (org: string): RequestContext => { const o = OrganizationId(org); return { organizationId: o, actor: ActorId('stop-monitor'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `stop-monitor-${org}` }; };
  const envelopes = new EnvelopeService(store);
  const bindings = new ResourceBindingService(store);
  const readinessSvc = new DiagnosisEvidenceService(store);
  return {
    leerEnvelope: (org) => envelopes.leerUltimo(org),
    leerCampaignBindingResourceName: async (org, envelopeId) => (await bindings.listar(org)).find((b) => b.envelopeId === envelopeId && b.entityType === 'campaign')?.providerResourceId ?? null,
    leerMetricas: async (org): Promise<MetricasCampania> => {
      const c = ctx(org);
      const snap = ultimoSnapshotAds(await store.readStream(c, adsSnapshotStreamId(org)));
      const readiness = await readinessSvc.leerUltima(org);
      // contactos first-party (Growth) — misma fuente que el operador de campaña; NO usa histórico de gasto.
      const obs = new ObservacionService(store, {} as never);
      let contacts = 0;
      for (const id of await obs.listarIds(c)) {
        const st = await obs.cargar(c, id);
        const p = st.datos?.provenanciaReal;
        if (st.datos?.naturaleza === 'REAL' && p?.provider === GROWTH && !p.diagnostico && p.eventName === EVENTO_CONTACTO) contacts += 1;
      }
      return { spend: snap?.cost ?? 0, contacts, trackingValid: readiness?.firstPartyTracking?.status === 'PASS', landingAvailable: readiness?.landing?.status === 'PASS', campaignStatus: snap?.status ?? null, snapshotCampaignId: snap?.campaignId ?? null };
    },
    leerUltimoStop: async (org): Promise<UltimoStop | null> => {
      const eventos = await store.readStream(ctx(org), stopMonitorStreamId(org));
      const ultimo = eventos.filter((e) => e.type === EVENTO_STOP).map((e) => e.payload as { campaignId: string | null; outcome: string }).slice(-1)[0];
      return ultimo ? { campaignId: ultimo.campaignId, outcome: ultimo.outcome } : null;
    },
    ...(pauseAdapter ? { pausarCampania: (customerId: string, resourceName: string) => pauseAdapter.pausarCampania(customerId, resourceName).then((r) => ({ ok: r.ok, requestId: r.requestId, resourceName: r.resourceName, errorStatus: r.errorStatus, errorMessage: r.errorMessage })) } : {}),
    registrarStop: async (org, decision, metricas, outcome, pausa, at) => {
      const c = ctx(org);
      const sid = stopMonitorStreamId(org);
      const prev = await store.readStream(c, sid);
      await store.append(c, sid, prev.length, [{ type: EVENTO_STOP, payload: { at, action: decision.action, reason: decision.reason, firedRuleIds: decision.firedRuleIds, campaignId: decision.campaignId, campaignResourceName: pausa?.resourceName ?? null, outcome, requestId: pausa?.requestId ?? null, errorStatus: pausa?.errorStatus ?? null, spend: metricas.spend, contacts: metricas.contacts, campaignStatus: metricas.campaignStatus }, attribution: ATR, occurredAt: at }]).catch(() => undefined);
    },
    ahora: () => new Date().toISOString(),
  };
}
