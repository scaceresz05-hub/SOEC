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

/** Resultado sanitizado de una pausa provider (sólo lo necesario; sin secretos). */
export interface ResultadoPausaProvider { readonly ok: boolean; readonly requestId: string | null; readonly resourceName: string | null; readonly errorStatus: string | null; readonly errorMessage: string | null }

export type OutcomeStop = 'NOOP' | 'ALREADY_STOPPED' | 'PAUSED' | 'FAILED_STOP_EXECUTION' | 'NO_PAUSE_ADAPTER';

export interface UltimoStop { readonly campaignId: string | null; readonly outcome: string }

/** Idempotencia de EJECUCIÓN: si ya existe un STOP con pausa EXITOSA (PAUSED) para esta campaña ⇒ no re-pausar. Un
 * intento FALLIDO previo (FAILED_STOP_EXECUTION) SÍ permite reintento (política de STOP, no ejecución comercial). */
export function debeSaltarPausa(ultimo: UltimoStop | null, campaignId: string | null): boolean {
  return !!ultimo && ultimo.campaignId === campaignId && ultimo.outcome === 'PAUSED';
}

const customerIdDe = (resourceName: string | null): string | null => resourceName?.match(/^customers\/(\d+)\//)?.[1] ?? null;

export interface DepsStopMonitor {
  readonly leerEnvelope: (org: string) => Promise<AuthorizedExecutionEnvelope | null>;
  readonly leerCampaignBindingResourceName: (org: string, envelopeId: string) => Promise<string | null>;
  /** Métricas de la campaña del BINDING (spend/status de esa campaña, no la histórica); contacts first-party. */
  readonly leerMetricas: (org: string, campaignBindingResourceName: string | null) => Promise<MetricasCampania>;
  /** Último STOP registrado (para idempotencia de ejecución). */
  readonly leerUltimoStop: (org: string) => Promise<UltimoStop | null>;
  /** ÚNICA capacidad provider del monitor: PAUSAR. Opcional (sin adapter ⇒ NO_PAUSE_ADAPTER, 0 writes). */
  readonly pausarCampania?: (customerId: string, resourceName: string) => Promise<ResultadoPausaProvider>;
  /** Persiste el resultado de un STOP ejecutado (regla, métricas, resourceName, requestId, outcome, at). */
  readonly registrarStop: (org: string, decision: DecisionMonitor, metricas: MetricasCampania, outcome: OutcomeStop, pausa: ResultadoPausaProvider | null, at: string) => Promise<void>;
  readonly ahora: () => string;
}

export interface ResultadoTick { readonly decision: DecisionMonitor; readonly outcome: OutcomeStop }

export class StopMonitorService {
  constructor(private readonly deps: DepsStopMonitor) {}

  /**
   * Un ciclo: decide y —si una regla dispara y la campaña está ENABLED— PAUSA realmente UNA vez (única acción). Sin
   * STOP ⇒ 0 writes. Ya pausada / ya-stopeada ⇒ 0 writes. Fail-closed: si la pausa provider falla ⇒ FAILED_STOP_EXECUTION
   * (no marca falso éxito; reintenta en un ciclo futuro bajo la política de STOP, sin loop agresivo).
   */
  async correrUnaVez(org: string): Promise<ResultadoTick> {
    const at = this.deps.ahora();
    const envelope = await this.deps.leerEnvelope(org);
    if (!envelope) return { decision: { action: 'NOOP', reason: 'NO_ENVELOPE', firedRuleIds: [], campaignId: null }, outcome: 'NOOP' };
    const bindingRN = await this.deps.leerCampaignBindingResourceName(org, envelope.id);
    const m = await this.deps.leerMetricas(org, bindingRN);
    const decision = decidirMonitorStop({ envelope, campaignBindingResourceName: bindingRN, snapshotCampaignId: m.snapshotCampaignId, campaignStatus: m.campaignStatus, spend: m.spend, contacts: m.contacts, trackingValid: m.trackingValid, landingAvailable: m.landingAvailable, now: at });
    if (decision.action !== 'STOP_CAMPAIGN') return { decision, outcome: 'NOOP' }; // 0 provider writes
    // STOP decidido ⇒ la campaña está ENABLED (decidirMonitorStop ya lo garantiza). Idempotencia de ejecución:
    const ultimo = await this.deps.leerUltimoStop(org);
    if (debeSaltarPausa(ultimo, decision.campaignId)) return { decision, outcome: 'ALREADY_STOPPED' }; // ya pausada con éxito ⇒ 0 writes
    // EJECUTAR exactamente UNA pausa real (única capacidad).
    const cid = customerIdDe(bindingRN);
    let outcome: OutcomeStop = 'NO_PAUSE_ADAPTER';
    let pausa: ResultadoPausaProvider | null = null;
    if (this.deps.pausarCampania && cid && bindingRN) {
      try { pausa = await this.deps.pausarCampania(cid, bindingRN); outcome = pausa.ok ? 'PAUSED' : 'FAILED_STOP_EXECUTION'; }
      catch (e) { pausa = { ok: false, requestId: null, resourceName: null, errorStatus: null, errorMessage: e instanceof Error ? e.message : String(e) }; outcome = 'FAILED_STOP_EXECUTION'; }
    }
    await this.deps.registrarStop(org, decision, m, outcome, pausa, at);
    return { decision, outcome };
  }
}

/** Arranca el loop periódico (setInterval, unref para no bloquear el cierre del proceso). */
export function iniciarStopMonitor(svc: StopMonitorService, org: string, intervaloMs: number, log?: (e: unknown) => void): { detener: () => void } {
  const tick = async (): Promise<void> => { try { const r = await svc.correrUnaVez(org); log?.({ stopMonitor: 'tick', org, action: r.decision.action, reason: r.decision.reason, outcome: r.outcome }); } catch (e) { log?.({ stopMonitor: 'error', org, error: e instanceof Error ? e.message : String(e) }); } };
  const timer = setInterval(() => void tick(), intervaloMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
  return { detener: () => clearInterval(timer) };
}
