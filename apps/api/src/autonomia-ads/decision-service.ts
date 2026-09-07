/**
 * apps/api · autonomia-ads · SERVICIO DE DECISIONES (event-sourced, 0 escrituras a Google).
 *
 * Cierra el BUCLE de decisión sobre la MISMA fuente de verdad que "Mi director": el resultado persistido por el
 * ciclo del Director (`director-cycle:<org>`). NO es un stack paralelo: la recomendación vigente se DERIVA de ese
 * resultado (misma `decisionId` que ve Inicio); este servicio sólo REGISTRA las acciones humanas (aprobar/rechazar/
 * ajustar) y las decisiones GENERADAS (p.ej. LAUNCH tras aprobar PREPARE) en un stream auditable `decisiones:<org>`.
 *
 * Semántica segura:
 *   - Aprobar PREPARE_EXPERIMENT_2 ⇒ 0 compromiso financiero, 0 escrituras a Google; genera una NUEVA decisión
 *     LAUNCH_EXPERIMENT_2 (PENDING) con plan concreto que REQUIERE una segunda aprobación humana.
 *   - Rechazar ⇒ persiste; la decisión no se vuelve a ofrecer mientras la evidencia no cambie (misma evidenceVersion).
 *   - Ajustar ⇒ SUPERSEDE la propuesta y genera otra (PENDING) con nuevo hash. Ningún ajuste autoriza gasto por sí solo.
 * Ninguna operación de este servicio escribe en Google: sólo append al event store.
 */
import { createHash } from 'node:crypto';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { DirectorResultado } from './director-cycle';
import type { PostMortem, RecommendedAction } from './director-postmortem';
import { CLICS_MIN_PARA_CONCLUIR } from './director-postmortem';

export type DecisionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ADJUSTMENT_REQUESTED' | 'SUPERSEDED' | 'EXECUTED' | 'FAILED';
export type DecisionType = RecommendedAction | 'LAUNCH_EXPERIMENT_2';

export const EVENTO_DECISION_CREADA = 'decision.creada';
export const EVENTO_DECISION_ESTADO = 'decision.estado';
export function decisionesStreamId(org: string): string { return `decisiones:${org}`; }

/** Registro de decisión, auditable. La base (PREPARE) se DERIVA del resultado del Director; LAUNCH/ajustes se PERSISTEN. */
export interface DecisionRecord {
  readonly decisionId: string;
  readonly recommendationId: string;
  readonly experimentId: string;
  readonly campaignId: string;
  readonly decisionType: DecisionType;
  readonly decisionStatus: DecisionStatus;
  readonly createdAt: string;
  readonly evidenceVersion: string;
  readonly planHash: string;
  readonly requiresHumanApproval: boolean;
  readonly confidence: string;                     // confianza causal de la evidencia (LOW/MEDIUM/HIGH)
  readonly financialCommitmentClp: number;        // PROPOSED_NEW_COMMITMENT (PREPARE ⇒ 0)
  readonly providerWritesExpected: number;         // escrituras a Google que produce aprobar ESTA decisión (PREPARE ⇒ 0)
  readonly title: string;
  readonly why: string;
  readonly plan: readonly string[];
  readonly historicalCampaignBudgetClp: number | null;
  readonly historicalSpendClp: number | null;
  readonly source: 'director' | 'prepare-approval' | 'adjust';
  readonly parentDecisionId: string | null;
  readonly supersedes: string | null;
}
export interface DecisionHistItem { readonly at: string; readonly tipo: string; readonly decisionId: string; readonly detalle: string; readonly actor: string | null }
export interface EstadoDecisiones { readonly current: DecisionRecord | null; readonly history: readonly DecisionHistItem[] }

type EventoEstado = { decisionId: string; status: DecisionStatus; at: string; actor: string | null; reason?: string | null; changes?: Record<string, unknown> | null; supersededBy?: string | null };

const ATR: Attribution = {
  source: 'decision-service',
  purpose: 'bucle de decisión humana (aprobar/rechazar/ajustar) sobre el resultado del Director; sin escrituras a Google',
  assumptions: ['sólo append al event store; idempotencia/one-shot por decisionId; ninguna mutación de proveedor'],
  claimType: 'observational', regime: 'empirical', uncertainty: 'baja',
};

function hash(...partes: unknown[]): string { return createHash('sha1').update(partes.map((p) => JSON.stringify(p ?? null)).join('|')).digest('hex').slice(0, 16); }

/**
 * DERIVA la decisión BASE (la recomendación vigente que requiere humano) del resultado persistido del Director.
 * Es una función PURA: garantiza que Inicio y Decisiones vean el MISMO decisionId. null si no hay decisión humana.
 */
export function derivarDecisionBase(resultado: DirectorResultado | null): DecisionRecord | null {
  if (!resultado) return null;
  const rec = resultado.analisis.recomendacion;
  const dp = resultado.analisis.decisionPack;
  if (!rec.humanApprovalRequired || !dp) return null;
  const experimentId = resultado.experimentId;
  const evidenceVersion = resultado.evidenceVersion;
  const recommendationId = `${experimentId}::${evidenceVersion}`;
  const decisionId = `${experimentId}::${rec.action}::${evidenceVersion}`;
  const plan = dp.proposedChanges;
  return {
    decisionId, recommendationId, experimentId, campaignId: resultado.campaignId,
    decisionType: rec.action, decisionStatus: 'PENDING', createdAt: resultado.createdAt, evidenceVersion,
    planHash: hash('base', decisionId, plan, rec.action),
    requiresHumanApproval: true, confidence: rec.confidence,
    financialCommitmentClp: dp.maxNewCommitmentClp ?? 0,
    providerWritesExpected: dp.providerWritesExpected,
    title: dp.decision, why: dp.reason, plan,
    historicalCampaignBudgetClp: dp.historicalCampaignBudgetClp, historicalSpendClp: dp.historicalSpendClp,
    source: 'director', parentDecisionId: null, supersedes: null,
  };
}

/** Presupuesto NUEVO del Experimento 2, calculado EXPLÍCITAMENTE (nunca reutiliza el histórico): objetivo de muestra
 * cualificada (CLICS_MIN_PARA_CONCLUIR) × techo de CPC propuesto (el CPC controlado de la fase, con piso prudente). */
export function presupuestoLaunch(pm: PostMortem): { cpcCapClp: number; newBudgetClp: number; targetClicks: number } {
  const cpcCapClp = Math.max(300, Math.round(pm.biddingAfter ?? pm.metrics.avgCpcClp ?? 900));
  const targetClicks = CLICS_MIN_PARA_CONCLUIR;
  const newBudgetClp = targetClicks * cpcCapClp;
  return { cpcCapClp, newBudgetClp, targetClicks };
}

function construirLaunch(base: DecisionRecord, pm: PostMortem, at: string, changes?: Record<string, unknown>): DecisionRecord {
  const { cpcCapClp, newBudgetClp, targetClicks } = presupuestoLaunch(pm);
  const negativas = pm.searchTermFindings.filter((t) => t.intent === 'NAVIGATIONAL' || t.intent === 'IRRELEVANT').map((t) => t.termino);
  const positivas = pm.keywordConcentration.map((k) => k.keyword);
  const geo = (changes?.['geo'] as string | undefined) ?? 'Chile (mercado objetivo)';
  const budget = typeof changes?.['budget'] === 'number' ? (changes['budget'] as number) : newBudgetClp;
  const cpcCap = typeof changes?.['maxCpc'] === 'number' ? (changes['maxCpc'] as number) : cpcCapClp;
  const plan: string[] = [
    'Objetivo: captar contactos cualificados (mismo producto, targeting acotado).',
    `Concordancia EXACTA en consultas comerciales${positivas.length ? ` (base: ${positivas.slice(0, 4).join(', ')})` : ''}.`,
    negativas.length ? `Negativas (navegacionales/irrelevantes): ${negativas.slice(0, 6).join(', ')}.` : 'Negativas: navegacionales/login y competidores sin intención compradora.',
    'Reutilizar anuncios existentes (sin regasto creativo).',
    `Geo: ${geo}. Red: sólo Búsqueda.`,
    `Puja: Maximizar clics con techo de CPC (CPC cap) = ${cpcCap} CLP.`,
    `Presupuesto NUEVO propuesto = ${budget} CLP (≈ ${targetClicks} clics objetivo × ${cpcCap} CLP; NO reutiliza el presupuesto histórico).`,
    'Stop de seguridad: pausa automática ante 0 contactos al alcanzar el presupuesto.',
    `Muestra esperada: ~${targetClicks} clics cualificados (menor volumen, mayor intención).`,
  ];
  const decisionId = `${base.experimentId}::LAUNCH_EXPERIMENT_2::${base.evidenceVersion}::${hash(changes ?? null, at)}`;
  return {
    decisionId, recommendationId: base.recommendationId, experimentId: base.experimentId, campaignId: base.campaignId,
    decisionType: 'LAUNCH_EXPERIMENT_2', decisionStatus: 'PENDING', createdAt: at, evidenceVersion: base.evidenceVersion,
    planHash: hash('launch', decisionId, plan, budget, cpcCap),
    requiresHumanApproval: true, confidence: base.confidence,
    financialCommitmentClp: budget,                                   // COMPROMISO NUEVO real (se autoriza acá)
    providerWritesExpected: 3 + positivas.length + negativas.length,  // crear campaña + grupo + red + keywords + negativas
    title: 'Lanzar Experimento 2 (plan concreto)', why: 'Plan detallado del Experimento 2 listo para autorizar. Sólo esta decisión puede dar lugar a gasto/creación real en Google.',
    plan, historicalCampaignBudgetClp: base.historicalCampaignBudgetClp, historicalSpendClp: base.historicalSpendClp,
    source: 'prepare-approval', parentDecisionId: base.decisionId, supersedes: null,
  };
}

export interface DepsDecisionService { readonly leerResultado: (org: string) => Promise<DirectorResultado | null>; readonly ahora?: () => string }

export class DecisionService {
  constructor(private readonly store: EventStore, private readonly deps: DepsDecisionService) {}

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('decision-service'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `decision-${org}` };
  }
  private ahora(): string { return this.deps.ahora?.() ?? new Date().toISOString(); }

  private async leerEventos(org: string): Promise<{ creadas: DecisionRecord[]; estados: EventoEstado[]; raw: { type: string; payload: unknown; occurredAt?: string }[] }> {
    const eventos = await this.store.readStream(this.ctx(org), decisionesStreamId(org));
    const creadas: DecisionRecord[] = []; const estados: EventoEstado[] = []; const raw: { type: string; payload: unknown; occurredAt?: string }[] = [];
    for (const e of eventos) {
      raw.push({ type: e.type, payload: e.payload, occurredAt: (e as { occurredAt?: string }).occurredAt });
      if (e.type === EVENTO_DECISION_CREADA) creadas.push(e.payload as DecisionRecord);
      else if (e.type === EVENTO_DECISION_ESTADO) estados.push(e.payload as EventoEstado);
    }
    return { creadas, estados, raw };
  }

  /** Estado del bucle: decisión VIGENTE (SSOT, misma que Inicio) + historial real. NO dispara análisis ni escribe. */
  async estado(org: string): Promise<EstadoDecisiones> {
    const resultado = await this.deps.leerResultado(org);
    const base = derivarDecisionBase(resultado);
    const { creadas, estados } = await this.leerEventos(org);

    // Universo de decisiones: base derivada + generadas persistidas (dedup por decisionId; la persistida gana).
    const porId = new Map<string, DecisionRecord>();
    if (base) porId.set(base.decisionId, base);
    for (const c of creadas) porId.set(c.decisionId, c);

    // Overlay del último estado por decisionId.
    const ultimoEstado = new Map<string, EventoEstado>();
    for (const s of estados) ultimoEstado.set(s.decisionId, s);
    const decisiones = [...porId.values()].map((d) => {
      const st = ultimoEstado.get(d.decisionId);
      return st ? { ...d, decisionStatus: st.status } : d;
    });

    // VIGENTE = la PENDING más reciente (una decisión generada más tarde —LAUNCH/ajuste— reemplaza a la base).
    const pendientes = decisiones.filter((d) => d.decisionStatus === 'PENDING').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const current = pendientes[pendientes.length - 1] ?? null;

    const history: DecisionHistItem[] = [];
    for (const c of creadas) history.push({ at: c.createdAt, tipo: 'GENERADA', decisionId: c.decisionId, detalle: c.title, actor: 'SOEC' });
    for (const s of estados) history.push({ at: s.at, tipo: s.status, decisionId: s.decisionId, detalle: s.reason ?? '', actor: s.actor });
    if (base) history.push({ at: base.createdAt, tipo: 'RECOMENDADA', decisionId: base.decisionId, detalle: base.title, actor: 'SOEC' });
    history.sort((a, b) => a.at.localeCompare(b.at));
    return { current, history };
  }

  private async buscarDecision(org: string, decisionId: string): Promise<DecisionRecord | null> {
    const resultado = await this.deps.leerResultado(org);
    const base = derivarDecisionBase(resultado);
    const { creadas, estados } = await this.leerEventos(org);
    const porId = new Map<string, DecisionRecord>();
    if (base) porId.set(base.decisionId, base);
    for (const c of creadas) porId.set(c.decisionId, c);
    const d = porId.get(decisionId);
    if (!d) return null;
    const st = [...estados].reverse().find((s) => s.decisionId === decisionId);
    return st ? { ...d, decisionStatus: st.status } : d;
  }

  private async append(org: string, type: string, payload: unknown): Promise<void> {
    const c = this.ctx(org); const sid = decisionesStreamId(org);
    const prev = await this.store.readStream(c, sid);
    await this.store.append(c, sid, prev.length, [{ type, payload, attribution: ATR, occurredAt: this.ahora() }]);
  }

  /** APROBAR (one-shot, verifica hash). PREPARE ⇒ 0 escrituras + genera LAUNCH (PENDING, 2ª aprobación). */
  async aprobar(org: string, decisionId: string, planHash: string, actor: string): Promise<{ ok: boolean; motivo?: string; generated?: DecisionRecord }> {
    const d = await this.buscarDecision(org, decisionId);
    if (!d) return { ok: false, motivo: 'NO_EXISTE' };
    if (d.decisionStatus !== 'PENDING') return { ok: false, motivo: 'YA_RESUELTA' };
    if (d.planHash !== planHash) return { ok: false, motivo: 'HASH_DESACTUALIZADO' };
    const at = this.ahora();
    await this.append(org, EVENTO_DECISION_ESTADO, { decisionId, status: 'APPROVED', at, actor });
    if (d.decisionType === 'PREPARE_EXPERIMENT_2') {
      const resultado = await this.deps.leerResultado(org);
      const pm = resultado?.analisis.postMortem;
      if (pm) {
        const launch = construirLaunch(d, pm, at);
        await this.append(org, EVENTO_DECISION_CREADA, launch);
        return { ok: true, generated: launch };
      }
    }
    return { ok: true };
  }

  /** RECHAZAR (persiste; no se re-ofrece con la misma evidencia). 0 escrituras. */
  async rechazar(org: string, decisionId: string, actor: string, reason?: string): Promise<{ ok: boolean; motivo?: string }> {
    const d = await this.buscarDecision(org, decisionId);
    if (!d) return { ok: false, motivo: 'NO_EXISTE' };
    if (d.decisionStatus !== 'PENDING') return { ok: false, motivo: 'YA_RESUELTA' };
    await this.append(org, EVENTO_DECISION_ESTADO, { decisionId, status: 'REJECTED', at: this.ahora(), actor, reason: reason ?? null });
    return { ok: true };
  }

  /** AJUSTAR (SUPERSEDE + genera nueva propuesta PENDING con nuevo hash). Ningún ajuste autoriza gasto por sí solo. */
  async ajustar(org: string, decisionId: string, changes: Record<string, unknown>, actor: string, note?: string): Promise<{ ok: boolean; motivo?: string; generated?: DecisionRecord }> {
    const d = await this.buscarDecision(org, decisionId);
    if (!d) return { ok: false, motivo: 'NO_EXISTE' };
    if (d.decisionStatus !== 'PENDING') return { ok: false, motivo: 'YA_RESUELTA' };
    const at = this.ahora();
    const resultado = await this.deps.leerResultado(org);
    const pm = resultado?.analisis.postMortem;
    // Nueva propuesta: si la base era PREPARE, el ajuste concreta el plan (como LAUNCH ajustado, PENDING, requiere aprobación).
    const nueva: DecisionRecord = pm
      ? { ...construirLaunch(d, pm, at, changes), source: 'adjust', supersedes: decisionId, why: `Propuesta ajustada por el titular${note ? `: ${note}` : ''}. Requiere tu aprobación; ningún ajuste gasta por sí solo.` }
      : { ...d, decisionId: `${d.decisionId}::adj::${hash(changes, at)}`, decisionStatus: 'PENDING', createdAt: at, source: 'adjust', supersedes: decisionId, planHash: hash('adjust', d.decisionId, changes, at), why: `Propuesta ajustada por el titular${note ? `: ${note}` : ''}.` };
    await this.append(org, EVENTO_DECISION_ESTADO, { decisionId, status: 'ADJUSTMENT_REQUESTED', at, actor, changes, supersededBy: nueva.decisionId });
    await this.append(org, EVENTO_DECISION_CREADA, nueva);
    return { ok: true, generated: nueva };
  }
}
