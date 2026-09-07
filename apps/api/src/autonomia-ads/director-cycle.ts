/**
 * apps/api · autonomia-ads · CICLO DEL DIRECTOR (server-side, autónomo).
 *
 * En cada ciclo natural (lo invoca el loop del servidor, NO la UI): resuelve la campaña vinculada real, lee su
 * evidencia READ-ONLY (métricas + keywords + search terms + device/geo/network + contactos + stop + readiness),
 * corre el motor puro y —si el experimento CERRÓ (stop/pausa/fin)— PERSISTE post-mortem + learning + decision pack
 * + notificación interna. Idempotente por experimentId (mismo cierre no duplica). La UI sólo LEE lo persistido.
 * NINGÚN write a Google: sólo lecturas GAQL + append al event store.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import type { EnvelopeService } from '../campana/envelope-service';
import type { ResourceBindingService } from '../campana/resource-binding';
import type { DiagnosisEvidenceService } from '../campana/diagnosis-evidence-service';
import { construirLectorCampaignProvider, type ProviderCampaignData } from '../campana/campaign-live';
import { construirLectorEvidenciaGoogle } from './director-evidence-reader';
import { analizarExperimento, type AnalisisDirector, type EvidenciaExperimento, type TermSpend } from './director-postmortem';
import { ExperimentMemoryService } from './experiment-memory';

export const EVENTO_DIRECTOR_RESULT = 'director-cycle.result';
export const EVENTO_DIRECTOR_NOTIF = 'director-notificacion.creada';
export function directorResultStreamId(org: string): string { return `director-cycle:${org}`; }
export function directorNotifStreamId(org: string): string { return `director-notificaciones:${org}`; }

export interface DirectorResultado {
  readonly experimentId: string; readonly campaignId: string; readonly campaignName: string | null; readonly status: string | null;
  readonly createdAt: string; readonly analisis: AnalisisDirector; readonly ranBy: 'scheduler' | 'endpoint';
}
export interface DirectorNotificacion { readonly at: string; readonly tipo: string; readonly mensaje: string; readonly experimentId: string }

type ClienteGoogle = { buscar: (customerId: string, query: string) => Promise<Array<Record<string, unknown>>> } | null;

export interface DepsDirectorCycle {
  readonly envelopes: EnvelopeService;
  readonly bindings: ResourceBindingService;
  readonly diagnosis: DiagnosisEvidenceService;
  readonly clienteFactory: (org: string) => ClienteGoogle;
  readonly ahora?: () => string;
}

const ATR: Attribution = {
  source: 'director-cycle',
  purpose: 'ciclo autónomo del director de marketing: post-mortem/recomendación/decisión persistidos server-side',
  assumptions: ['sólo lecturas Google + append al event store; idempotente por experimentId; ninguna escritura provider'],
  claimType: 'observational', regime: 'empirical', uncertainty: 'media',
};

export class DirectorCycleService {
  constructor(private readonly store: EventStore, private readonly deps: DepsDirectorCycle) {}

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('director-cycle'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `director-cycle-${org}` };
  }
  private ahora(): string { return this.deps.ahora?.() ?? new Date().toISOString(); }

  /** Lee el resultado PERSISTIDO más reciente (para la UI/endpoint; NO dispara análisis). */
  async leerResultado(org: string): Promise<DirectorResultado | null> {
    const eventos = await this.store.readStream(this.ctx(org), directorResultStreamId(org));
    return eventos.filter((e) => e.type === EVENTO_DIRECTOR_RESULT).map((e) => e.payload as DirectorResultado).slice(-1)[0] ?? null;
  }
  async leerNotificaciones(org: string): Promise<DirectorNotificacion[]> {
    const eventos = await this.store.readStream(this.ctx(org), directorNotifStreamId(org));
    return eventos.filter((e) => e.type === EVENTO_DIRECTOR_NOTIF).map((e) => e.payload as DirectorNotificacion);
  }

  /** Arma la evidencia REAL del experimento vigente (o null si no hay campaña vinculada). READ-ONLY. */
  async armarEvidencia(org: string): Promise<{ evidencia: EvidenciaExperimento; campaignName: string | null; experimentId: string } | null> {
    const c = this.ctx(org);
    const envelope = await this.deps.envelopes.leerUltimo(org);
    if (!envelope) return null;
    const bindings = await this.deps.bindings.listar(org);
    const binding = bindings.find((b) => b.envelopeId === envelope.id && b.entityType === 'campaign') ?? null;
    const resourceName = binding?.providerResourceId;
    if (!resourceName) return null;
    const campaignId = resourceName.match(/campaigns\/(\d+)$/)?.[1] ?? '';
    const customerId = resourceName.match(/^customers\/(\d+)\//)?.[1] ?? null;
    const now = this.ahora();
    const ventana = { desde: new Date(Date.parse(now) - 30 * 86_400_000).toISOString().slice(0, 10), hasta: now.slice(0, 10) };
    const cliente = this.deps.clienteFactory(org);
    let provider: ProviderCampaignData = { core: null, dates: null, metrics: null, evolution: [] };
    let ev = { keywords: [], devices: [], geos: [], networks: [] } as Awaited<ReturnType<ReturnType<typeof construirLectorEvidenciaGoogle>>>;
    if (cliente && customerId && campaignId) {
      try { provider = await construirLectorCampaignProvider((cid, q) => cliente.buscar(cid, q))(customerId, campaignId, ventana); } catch { /* fail-soft */ }
      try { ev = await construirLectorEvidenciaGoogle((cid, q) => cliente.buscar(cid, q))(customerId, campaignId, ventana); } catch { /* fail-soft */ }
    }
    const nombreVigente = provider.core?.name ?? null;
    // Contactos first-party + search terms (con gasto) AISLADOS a la campaña vigente (por nombre).
    const obs = new ObservacionService(this.store, {} as never);
    let contacts = 0;
    const terminosMap = new Map<string, { impresiones: number; clics: number; gasto: number; gastoVisto: boolean }>();
    for (const id of await obs.listarIds(c)) {
      const st = await obs.cargar(c, id); const d = st.datos; const p = d?.provenanciaReal;
      if (d?.naturaleza !== 'REAL' || !p) continue;
      if (p.provider === 'smileflow-growth' && !p.diagnostico && p.eventName === 'lead_created') { contacts += 1; continue; }
      if (p.eventName === 'ads_search_term' && p.utmContent && (nombreVigente == null || p.utmCampaign === nombreVigente)) {
        const acc = terminosMap.get(p.utmContent) ?? { impresiones: 0, clics: 0, gasto: 0, gastoVisto: false };
        if (d.metrica === 'search_term_impressions') acc.impresiones += d.valor ?? 0;
        else if (d.metrica === 'search_term_clicks') acc.clics += d.valor ?? 0;
        else if (d.metrica === 'search_term_cost') { acc.gasto += d.valor ?? 0; acc.gastoVisto = true; }
        terminosMap.set(p.utmContent, acc);
      }
    }
    const terminos: TermSpend[] = [...terminosMap.entries()].map(([termino, v]) => ({ termino, impresiones: v.impresiones, clics: v.clics, gasto: v.gastoVisto ? v.gasto : null }));
    const readiness = await this.deps.diagnosis.leerUltima(org);
    const dias = provider.evolution.filter((e2) => e2.clicks > 0);
    const cpcDe = (e2: { spendClp: number; clicks: number }): number => e2.spendClp / e2.clicks;
    const spend = provider.metrics?.spendClp ?? null;
    const clicks = provider.metrics?.clicks ?? null;
    const zeroStopClp = envelope.maxSpendWithoutContact;
    const reEnabled = (rid: string): boolean => envelope.stopRules.find((s) => s.id === rid)?.enabled !== false;
    const stopTriggered = reEnabled('STOP_ZERO_CONVERSION') && contacts === 0 && spend != null && spend >= zeroStopClp;
    const periodoTerminado = !!envelope.expiresAt && now >= envelope.expiresAt;
    const evidencia: EvidenciaExperimento = {
      campaignId, status: provider.core?.status ?? null, periodoTerminado,
      spend, experimentBudgetClp: envelope.experimentBudget, impressions: provider.metrics?.impressions ?? null,
      clicks, contacts, conversions: provider.metrics?.conversions ?? null,
      avgCpcClp: clicks && spend != null ? Math.round(spend / clicks) : null,
      ctr: provider.metrics && provider.metrics.impressions ? Math.round((provider.metrics.clicks ?? 0) / provider.metrics.impressions * 1000) / 10 : null,
      keywords: ev.keywords, terminos, devices: ev.devices, geos: ev.geos, networks: ev.networks,
      trackingValid: readiness?.firstPartyTracking?.status === 'PASS', landingValid: readiness?.landing?.status === 'PASS',
      zeroContactStopClp: zeroStopClp, stopTriggered, stopRule: stopTriggered ? 'STOP_ZERO_CONVERSION' : null,
      cpcInicialClp: dias.length >= 2 ? Math.round(cpcDe(dias[0]!)) : null,
      cpcPosteriorClp: dias.length >= 2 ? Math.round(cpcDe(dias[dias.length - 1]!)) : (clicks && spend != null ? Math.round(spend / clicks) : null),
    };
    const experimentId = `${campaignId}:${evidencia.stopRule ?? (periodoTerminado ? 'ended' : 'running')}`;
    return { evidencia, campaignName: nombreVigente, experimentId };
  }

  /**
   * Un ciclo autónomo. Arma evidencia, analiza y —si el experimento CERRÓ— persiste resultado+learning+notificación
   * (idempotente por experimentId). Devuelve el análisis (o null si no hay campaña). NO escribe en Google.
   */
  async correrCiclo(org: string, ranBy: 'scheduler' | 'endpoint' = 'scheduler'): Promise<{ analisis: AnalisisDirector; persistido: boolean; resumen: Record<string, unknown> } | null> {
    const armado = await this.armarEvidencia(org);
    if (!armado) return null;
    const { evidencia, campaignName, experimentId } = armado;
    const memoria = new ExperimentMemoryService(this.store);
    const aprendizajes = await memoria.aprendizajesPrevios(org, experimentId);
    const analisis = analizarExperimento(evidencia, aprendizajes);
    const cerrado = evidencia.stopTriggered || evidencia.periodoTerminado || evidencia.status === 'PAUSED';
    const resumen = { status: evidencia.status, spend: evidencia.spend, clicks: evidencia.clicks, contacts: evidencia.contacts, keywords: evidencia.keywords.length, terminos: evidencia.terminos.length, stopTriggered: evidencia.stopTriggered, cerrado, experimentId };
    if (!cerrado) return { analisis, persistido: false, resumen };

    const c = this.ctx(org); const now = this.ahora();
    // Idempotencia: si ya hay un resultado persistido para este experimentId, no duplicar (conserva createdAt).
    const previo = await this.leerResultado(org);
    if (previo && previo.experimentId === experimentId) return { analisis, persistido: false, resumen: { ...resumen, previoCreatedAt: previo.createdAt, previoRanBy: previo.ranBy } };

    const resultado: DirectorResultado = { experimentId, campaignId: evidencia.campaignId, campaignName, status: evidencia.status, createdAt: now, analisis, ranBy };
    const sid = directorResultStreamId(org);
    const prev = await this.store.readStream(c, sid);
    await this.store.append(c, sid, prev.length, [{ type: EVENTO_DIRECTOR_RESULT, payload: resultado, attribution: ATR, occurredAt: now }]).catch(() => undefined);

    // Learning idempotente + notificación interna (una por experimento) cuando se requiere decisión humana.
    await memoria.registrar(org, {
      experimentId, campaignId: evidencia.campaignId, at: now, hypothesis: null,
      configuration: { experimentBudgetClp: evidencia.experimentBudgetClp, cpcCap: evidencia.cpcPosteriorClp },
      results: { spend: evidencia.spend, clicks: evidencia.clicks, contacts: evidencia.contacts, conversions: evidencia.conversions, avgCpc: evidencia.avgCpcClp },
      stopReason: evidencia.stopRule, postmortemSummary: `${analisis.postMortem.trafficQuality} · ${analisis.recomendacion.action}`,
      learning: analisis.postMortem.diagnosis.map((d) => `${d.factor}: ${d.evidencia}`).join(' '),
      nextRecommendation: analisis.recomendacion.action,
      avoidAction: analisis.postMortem.trafficQuality === 'POOR' || analisis.postMortem.trafficQuality === 'MIXED' ? 'KEEP_RUNNING' : null,
    }).catch(() => undefined);

    if (analisis.recomendacion.humanApprovalRequired) {
      const nsid = directorNotifStreamId(org);
      const nprev = await this.store.readStream(c, nsid);
      const yaNotificado = nprev.some((e) => e.type === EVENTO_DIRECTOR_NOTIF && (e.payload as DirectorNotificacion).experimentId === experimentId);
      if (!yaNotificado) {
        const notif: DirectorNotificacion = { at: now, tipo: 'DECISION_REQUIRED', mensaje: 'SOEC requiere tu decisión: hay una recomendación lista para aprobar.', experimentId };
        await this.store.append(c, nsid, nprev.length, [{ type: EVENTO_DIRECTOR_NOTIF, payload: notif, attribution: ATR, occurredAt: now }]).catch(() => undefined);
      }
    }
    return { analisis, persistido: true, resumen };
  }
}

/** Arranca el ciclo del director en el loop del servidor (setInterval + una corrida inmediata al boot). */
export function iniciarDirectorCycle(svc: DirectorCycleService, org: string, intervaloMs: number, log?: (e: unknown) => void): { detener: () => void } {
  const tick = async (): Promise<void> => { try { const r = await svc.correrCiclo(org, 'scheduler'); log?.({ directorCycle: 'tick', org, persistido: r?.persistido ?? false, hayCampania: r !== null, resumen: r?.resumen ?? null }); } catch (e) { log?.({ directorCycle: 'error', org, error: e instanceof Error ? e.message : String(e) }); } };
  void tick(); // corrida inmediata: el resultado nace en el boot, ANTES de cualquier lectura de la UI
  const timer = setInterval(() => void tick(), intervaloMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
  return { detener: () => clearInterval(timer) };
}
