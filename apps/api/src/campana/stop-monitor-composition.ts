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
import type { GoogleAdsPauseAdapter } from './google-ads-pause-adapter';
import type { DepsStopMonitor, MetricasCampania, UltimoStop } from './stop-monitor';

const GROWTH = 'smileflow-growth';
const EVENTO_CONTACTO = 'lead_created';
export const EVENTO_STOP = 'stop-monitor.stop';
export const EVENTO_STOP_TICK = 'stop-monitor.tick';
export function stopMonitorStreamId(org: string): string { return `stop-monitor:${org}`; }
export function stopMonitorTickStreamId(org: string): string { return `stop-monitor-tick:${org}`; }

/** Estructura del heartbeat (lo que el monitor OBSERVÓ y decidió en un tick). Campos observed null si el tick terminó
 * antes de leer métricas (p.ej. sin envelope) o son ticks previos al enriquecimiento. */
export interface TickHeartbeat { readonly at: string; readonly action: string; readonly reason: string | null; readonly outcome: string; readonly campaignId: string | null; readonly campaignStatusObserved: string | null; readonly spendObserved: number | null; readonly contactsObserved: number | null }

/** Último tick del monitor (heartbeat durable) — para que la UI pruebe que está VIVO y qué OBSERVÓ, no sólo configurado. */
export async function leerUltimoTick(store: EventStore, org: string): Promise<TickHeartbeat | null> {
  const o = OrganizationId(org);
  const ctx: RequestContext = { organizationId: o, actor: ActorId('stop-monitor-read'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: `stop-monitor-read-${org}` };
  const eventos = await store.readStream(ctx, stopMonitorTickStreamId(org));
  const p = eventos.filter((e) => e.type === EVENTO_STOP_TICK).map((e) => e.payload as Partial<TickHeartbeat>).slice(-1)[0];
  if (!p) return null;
  return { at: p.at ?? '', action: p.action ?? 'NOOP', reason: p.reason ?? null, outcome: p.outcome ?? 'NOOP', campaignId: p.campaignId ?? null, campaignStatusObserved: p.campaignStatusObserved ?? null, spendObserved: p.spendObserved ?? null, contactsObserved: p.contactsObserved ?? null };
}

const ATR: Attribution = { source: 'stop-monitor', purpose: 'pausa automática por regla de stop autorizada (reducción de riesgo)', assumptions: ['única acción provider = PAUSE; nunca create/enable/budget/targeting'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

/** Métricas provider (READ-ONLY) de UNA campaña específica: spend (de esa campaña, no la histórica) + status. */
export type LeerMetricasProvider = (customerId: string, campaignId: string) => Promise<{ cost: number; status: string | null } | null>;

/**
 * Lector de métricas por campaignId vía GAQL READ-ONLY (dos consultas: status y cost del PERÍODO). El WHERE filtra por
 * campaign.id ⇒ el spend es EXCLUSIVAMENTE de esa campaña (nunca suma la histórica 24120966895). Sin writes.
 */
export function construirLectorMetricasCampania(buscar: (customerId: string, query: string) => Promise<Array<Record<string, unknown>>>): LeerMetricasProvider {
  return async (customerId, campaignId) => {
    const statusRows = await buscar(customerId, `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${campaignId}`);
    const status = (statusRows[0] as { campaign?: { status?: string } } | undefined)?.campaign?.status ?? null;
    if (!status) return null; // campaña no encontrada ⇒ métricas indisponibles
    // Gasto ACUMULADO (lifetime) de LA campaña, SIN filtro de fecha. Un `DURING` suelto rompía la consulta (HTTP 400)
    // y hacía que TODO el lector rechazara ⇒ el monitor leía status=null y decidía ALREADY_PAUSED falsamente. Como la
    // campaña del experimento es nueva, lifetime = gasto del experimento (aislado por WHERE campaign.id, nunca histórica).
    const costRows = await buscar(customerId, `SELECT campaign.id, metrics.cost_micros FROM campaign WHERE campaign.id = ${campaignId}`);
    const costMicros = Number((costRows[0] as { metrics?: { costMicros?: string | number } } | undefined)?.metrics?.costMicros ?? 0);
    return { cost: costMicros / 1_000_000, status };
  };
}

const idCampania = (rn: string | null): string | null => rn?.match(/campaigns\/(\d+)$/)?.[1] ?? null;
const idCustomer = (rn: string | null): string | null => rn?.match(/^customers\/(\d+)\//)?.[1] ?? null;

/** `pausar` es opcional: sin adapter configurado el monitor decide pero no pausa (NO_PAUSE_ADAPTER, 0 writes).
 * `leerMetricasProvider` lee el spend/status de LA campaña del binding (no la histórica); null ⇒ métricas indisponibles. */
export function crearDepsStopMonitor(store: EventStore, pauseAdapter: GoogleAdsPauseAdapter | null, leerMetricasProvider: LeerMetricasProvider | null): DepsStopMonitor {
  const ctx = (org: string): RequestContext => { const o = OrganizationId(org); return { organizationId: o, actor: ActorId('stop-monitor'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `stop-monitor-${org}` }; };
  const envelopes = new EnvelopeService(store);
  const bindings = new ResourceBindingService(store);
  const readinessSvc = new DiagnosisEvidenceService(store);
  return {
    leerEnvelope: (org) => envelopes.leerUltimo(org),
    leerCampaignBindingResourceName: async (org, envelopeId) => (await bindings.listar(org)).find((b) => b.envelopeId === envelopeId && b.entityType === 'campaign')?.providerResourceId ?? null,
    leerMetricas: async (org, campaignBindingResourceName): Promise<MetricasCampania> => {
      const c = ctx(org);
      const readiness = await readinessSvc.leerUltima(org);
      // contactos first-party (Growth) — misma fuente que el operador de campaña; NO usa histórico de gasto.
      const obs = new ObservacionService(store, {} as never);
      let contacts = 0;
      for (const id of await obs.listarIds(c)) {
        const st = await obs.cargar(c, id);
        const p = st.datos?.provenanciaReal;
        if (st.datos?.naturaleza === 'REAL' && p?.provider === GROWTH && !p.diagnostico && p.eventName === EVENTO_CONTACTO) contacts += 1;
      }
      // SPEND/STATUS de LA campaña del BINDING (no la histórica): lectura provider por campaignId del binding. El
      // guard METRICS_NOT_FOR_BOUND_CAMPAIGN se preserva: sólo si la métrica ES de esa campaña, snapshotCampaignId
      // coincide. Sin lectura disponible ⇒ snapshotCampaignId=null (fail-closed: el monitor no actúa con datos ajenos).
      const campaignId = idCampania(campaignBindingResourceName);
      const customerId = idCustomer(campaignBindingResourceName);
      let spend = 0; let campaignStatus: string | null = null; let snapshotCampaignId: string | null = null;
      if (campaignId && customerId && leerMetricasProvider) {
        const m = await leerMetricasProvider(customerId, campaignId).catch(() => null);
        if (m) { spend = m.cost; campaignStatus = m.status; snapshotCampaignId = campaignId; }
      }
      return { spend, contacts, trackingValid: readiness?.firstPartyTracking?.status === 'PASS', landingAvailable: readiness?.landing?.status === 'PASS', campaignStatus, snapshotCampaignId };
    },
    leerUltimoStop: async (org): Promise<UltimoStop | null> => {
      const eventos = await store.readStream(ctx(org), stopMonitorStreamId(org));
      const ultimo = eventos.filter((e) => e.type === EVENTO_STOP).map((e) => e.payload as { campaignId: string | null; outcome: string }).slice(-1)[0];
      return ultimo ? { campaignId: ultimo.campaignId, outcome: ultimo.outcome } : null;
    },
    ...(pauseAdapter ? { pausarCampania: (customerId: string, resourceName: string) => pauseAdapter.pausarCampania(customerId, resourceName).then((r) => ({ ok: r.ok, requestId: r.requestId, resourceName: r.resourceName, errorStatus: r.errorStatus, errorMessage: r.errorMessage })) } : {}),
    registrarTick: async (org, decision, metricas, outcome, at) => {
      const c = ctx(org); const sid = stopMonitorTickStreamId(org);
      const prev = await store.readStream(c, sid);
      // Heartbeat enriquecido: además de la decisión, QUÉ observó el monitor (estado/gasto/contactos de la campaña del
      // binding) para que la UI explique honestamente cualquier desfase con la lectura hecha AHORA (sin ocultarlo).
      await store.append(c, sid, prev.length, [{ type: EVENTO_STOP_TICK, payload: { at, action: decision.action, reason: decision.reason, outcome, campaignId: decision.campaignId, campaignStatusObserved: metricas?.campaignStatus ?? null, spendObserved: metricas?.spend ?? null, contactsObserved: metricas?.contacts ?? null }, attribution: ATR, occurredAt: at }]).catch(() => undefined);
    },
    registrarStop: async (org, decision, metricas, outcome, pausa, at) => {
      const c = ctx(org);
      const sid = stopMonitorStreamId(org);
      const prev = await store.readStream(c, sid);
      await store.append(c, sid, prev.length, [{ type: EVENTO_STOP, payload: { at, action: decision.action, reason: decision.reason, firedRuleIds: decision.firedRuleIds, campaignId: decision.campaignId, campaignResourceName: pausa?.resourceName ?? null, outcome, requestId: pausa?.requestId ?? null, errorStatus: pausa?.errorStatus ?? null, spend: metricas.spend, contacts: metricas.contacts, campaignStatus: metricas.campaignStatus }, attribution: ATR, occurredAt: at }]).catch(() => undefined);
    },
    ahora: () => new Date().toISOString(),
  };
}
