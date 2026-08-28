/**
 * apps/api · campana · MONITOR AUTOMÁTICO de STOPS (conecta las reglas YA EXISTENTES a un loop productivo). NO crea
 * reglas: sólo invoca `evaluarStopVigente`. Su ÚNICA acción posible es STOP_CAMPAIGN (reducción de riesgo, no-creación);
 * NUNCA habilita, aumenta presupuesto, crea recursos, cambia targeting ni toca la histórica.
 *
 * SEGURIDAD: el monitor NO tiene capacidad de escritura a Google (no recibe ningún puerto de mutate) ⇒
 * estructuralmente 0 provider writes. Emite/registra la DECISIÓN de stop; la ejecución del pause real vive detrás
 * del gate `supervisedReal` existente (hoy false). Idempotente: campaña ya PAUSED ⇒ NOOP; una regla que dispara dos
 * ciclos ⇒ una sola decisión efectiva. Aislamiento histórico: opera SÓLO sobre el binding de campaña del envelope
 * vigente; si las métricas no son de esa campaña, NOOP (no actúa sobre otra, p.ej. la histórica).
 */
import { evaluarStopVigente } from './stop-enforcement';
import type { AuthorizedExecutionEnvelope } from './authorized-execution-envelope';

export type AccionMonitor = 'NOOP' | 'STOP_CAMPAIGN';

export interface DecisionMonitor {
  readonly action: AccionMonitor;
  readonly reason: string | null;
  readonly firedRuleIds: readonly string[];
  readonly campaignId: string | null;
}

export interface EntradaMonitor {
  readonly envelope: AuthorizedExecutionEnvelope;
  /** resourceName del CAMPAIGN binding recuperado (identidad de la campaña); null ⇒ sin identidad. */
  readonly campaignBindingResourceName: string | null;
  /** campaignId del ads snapshot leído (para verificar que las métricas son de la campaña del binding). */
  readonly snapshotCampaignId: string | null;
  readonly campaignStatus: string | null; // ENABLED/PAUSED del proveedor
  readonly spend: number;                  // gasto del EXPERIMENTO (no histórico)
  readonly contacts: number;               // contactos first-party atribuibles
  readonly trackingValid: boolean;
  readonly landingAvailable: boolean;
  readonly now: string;
}

const idDeResourceName = (rn: string | null): string | null => rn?.match(/campaigns\/(\d+)$/)?.[1] ?? null;

/**
 * Decide (PURO) qué hacer este ciclo. Fail-closed y con aislamiento histórico. La ventana STOP_PERIOD usa
 * `envelope.expiresAt` (null antes de activar ⇒ no dispara todavía), coherente con la doctrina existente.
 */
export function decidirMonitorStop(e: EntradaMonitor): DecisionMonitor {
  // 1) IDENTIDAD: sin CAMPAIGN binding no hay campaña sobre la cual actuar ⇒ NOOP.
  const campaignId = idDeResourceName(e.campaignBindingResourceName);
  if (!campaignId) return { action: 'NOOP', reason: 'NO_CAMPAIGN_BINDING', firedRuleIds: [], campaignId: null };
  // 2) AISLAMIENTO HISTÓRICO: las métricas deben ser de LA campaña del binding (nunca de otra, p.ej. 24120966895).
  if (e.snapshotCampaignId !== null && e.snapshotCampaignId !== campaignId) return { action: 'NOOP', reason: 'METRICS_NOT_FOR_BOUND_CAMPAIGN', firedRuleIds: [], campaignId };
  // 3) IDEMPOTENCIA: si la campaña ya está PAUSED (o no ENABLED), NOOP (no re-pausar).
  if (e.campaignStatus !== 'ENABLED') return { action: 'NOOP', reason: 'ALREADY_PAUSED', firedRuleIds: [], campaignId };
  // 4) EVALUAR las reglas EXISTENTES. Cualquier regla satisfecha ⇒ STOP_CAMPAIGN (única acción, reductora de riesgo).
  const dec = evaluarStopVigente(e.envelope, { spend: e.spend, contacts: e.contacts, trackingValid: e.trackingValid, landingAvailable: e.landingAvailable, now: e.now });
  if (dec.stop && dec.action === 'STOP_CAMPAIGN') return { action: 'STOP_CAMPAIGN', reason: dec.firedRuleIds.join('+'), firedRuleIds: dec.firedRuleIds, campaignId };
  return { action: 'NOOP', reason: null, firedRuleIds: [], campaignId };
}

/** IDEMPOTENCIA (PURA): sólo se persiste un STOP nuevo. NOOP no se persiste; un STOP idéntico ya vigente tampoco. */
export function debePersistir(previa: { action: string; campaignId: string | null; firedRuleIds?: readonly string[] } | null, nueva: DecisionMonitor): boolean {
  if (nueva.action !== 'STOP_CAMPAIGN') return false;
  if (previa?.action === 'STOP_CAMPAIGN' && previa.campaignId === nueva.campaignId && (previa.firedRuleIds ?? []).join('+') === nueva.firedRuleIds.join('+')) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Servicio de tick (orquestación I/O fina). Los lectores se INYECTAN ⇒ testable y sin acoplar el loop.
// ─────────────────────────────────────────────────────────────────────────────
export interface MetricasCampania {
  readonly spend: number;
  readonly contacts: number;
  readonly trackingValid: boolean;
  readonly landingAvailable: boolean;
  readonly campaignStatus: string | null;
  readonly snapshotCampaignId: string | null;
}

export interface DepsStopMonitor {
  readonly leerEnvelope: (org: string) => Promise<AuthorizedExecutionEnvelope | null>;
  readonly leerCampaignBindingResourceName: (org: string, envelopeId: string) => Promise<string | null>;
  readonly leerMetricas: (org: string) => Promise<MetricasCampania>;
  /** Persiste la decisión (idempotente: no duplica un STOP ya vigente). NO escribe a Google. */
  readonly registrarDecision: (org: string, decision: DecisionMonitor, metricas: MetricasCampania, at: string) => Promise<void>;
  readonly ahora: () => string;
}

export class StopMonitorService {
  constructor(private readonly deps: DepsStopMonitor) {}

  /** Un ciclo del monitor para una org. Devuelve la decisión. NUNCA escribe a Google (0 writes por construcción). */
  async correrUnaVez(org: string): Promise<DecisionMonitor> {
    const at = this.deps.ahora();
    const envelope = await this.deps.leerEnvelope(org);
    if (!envelope) { const d: DecisionMonitor = { action: 'NOOP', reason: 'NO_ENVELOPE', firedRuleIds: [], campaignId: null }; return d; }
    const bindingRN = await this.deps.leerCampaignBindingResourceName(org, envelope.id);
    const m = await this.deps.leerMetricas(org);
    const decision = decidirMonitorStop({ envelope, campaignBindingResourceName: bindingRN, snapshotCampaignId: m.snapshotCampaignId, campaignStatus: m.campaignStatus, spend: m.spend, contacts: m.contacts, trackingValid: m.trackingValid, landingAvailable: m.landingAvailable, now: at });
    await this.deps.registrarDecision(org, decision, m, at);
    return decision;
  }
}

/** Arranca el loop periódico (setInterval, unref para no bloquear el cierre del proceso). */
export function iniciarStopMonitor(svc: StopMonitorService, org: string, intervaloMs: number, log?: (e: unknown) => void): { detener: () => void } {
  const tick = async (): Promise<void> => { try { const d = await svc.correrUnaVez(org); log?.({ stopMonitor: 'tick', org, action: d.action, reason: d.reason }); } catch (e) { log?.({ stopMonitor: 'error', org, error: e instanceof Error ? e.message : String(e) }); } };
  const timer = setInterval(() => void tick(), intervaloMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
  return { detener: () => clearInterval(timer) };
}
