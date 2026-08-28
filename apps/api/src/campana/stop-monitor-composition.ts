/**
 * apps/api · campana · COMPOSICIÓN del monitor de stops: cablea servicios EXISTENTES (envelope, bindings, ads
 * snapshot, readiness, contactos Growth) en `DepsStopMonitor`. NO agrega lógica de negocio ni capacidad de escritura
 * a Google — sólo lee y registra la decisión (0 provider writes por construcción).
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { EnvelopeService } from './envelope-service';
import { ResourceBindingService } from './resource-binding';
import { DiagnosisEvidenceService } from './diagnosis-evidence-service';
import { adsSnapshotStreamId, ultimoSnapshotAds } from '../ingesta/ingesta-google-ads-service';
import { debePersistir, type DepsStopMonitor, type MetricasCampania } from './stop-monitor';

const GROWTH = 'smileflow-growth';
const EVENTO_CONTACTO = 'lead_created';
export const EVENTO_STOP_DECISION = 'stop-monitor.decision';
export function stopMonitorStreamId(org: string): string { return `stop-monitor:${org}`; }

const ATR: Attribution = { source: 'stop-monitor', purpose: 'monitoreo de reglas de stop (READ + registro; sin efecto externo)', assumptions: ['0 provider writes; sólo STOP_CAMPAIGN como intención'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

export function crearDepsStopMonitor(store: EventStore): DepsStopMonitor {
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
    registrarDecision: async (org, decision, metricas, at) => {
      const c = ctx(org);
      const sid = stopMonitorStreamId(org);
      const prev = await store.readStream(c, sid);
      const ultima = prev.filter((e) => e.type === EVENTO_STOP_DECISION).map((e) => e.payload as { action: string; campaignId: string | null; firedRuleIds?: string[] }).slice(-1)[0] ?? null;
      if (!debePersistir(ultima, decision)) return; // NOOP o STOP ya vigente ⇒ no duplica
      await store.append(c, sid, prev.length, [{ type: EVENTO_STOP_DECISION, payload: { at, action: decision.action, reason: decision.reason, firedRuleIds: decision.firedRuleIds, campaignId: decision.campaignId, spend: metricas.spend, contacts: metricas.contacts, campaignStatus: metricas.campaignStatus }, attribution: ATR, occurredAt: at }]).catch(() => undefined);
    },
    ahora: () => new Date().toISOString(),
  };
}
