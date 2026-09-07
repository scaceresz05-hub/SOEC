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
import { construirLectorEvidenciaGoogle, construirLectorCambiosBidding } from './director-evidence-reader';
import { analizarExperimento, type AnalisisDirector, type EvidenciaExperimento, type PhaseInfo } from './director-postmortem';
import { ExperimentMemoryService } from './experiment-memory';

export const EVENTO_DIRECTOR_RESULT = 'director-cycle.result';
export const EVENTO_DIRECTOR_NOTIF = 'director-notificacion.creada';
export function directorResultStreamId(org: string): string { return `director-cycle:${org}`; }
export function directorNotifStreamId(org: string): string { return `director-notificaciones:${org}`; }

/** Versión de la evidencia/análisis. Al cambiar, una nueva corrida SUPERSEDES el post-mortem anterior (last-wins),
 * sin duplicar la decisión activa y sin borrar la auditoría (el evento previo permanece en el stream). */
export const EVIDENCE_VERSION = 'v2-phase-segmented';
export interface DirectorResultado {
  readonly experimentId: string; readonly campaignId: string; readonly campaignName: string | null; readonly status: string | null;
  readonly createdAt: string; readonly analisis: AnalisisDirector; readonly ranBy: 'scheduler' | 'endpoint';
  readonly evidenceVersion: string; readonly supersedes: string | null;
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
  async armarEvidencia(org: string): Promise<{ evidencia: EvidenciaExperimento; campaignName: string | null; experimentId: string; diag: { biddingChanges: number; changePoint: string | null; phase2Desde: string } } | null> {
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
    const buscar = cliente ? (cid: string, q: string): Promise<Array<Record<string, unknown>>> => cliente.buscar(cid, q) : null;
    let provider: ProviderCampaignData = { core: null, dates: null, metrics: null, evolution: [] };
    let cambios: Awaited<ReturnType<ReturnType<typeof construirLectorCambiosBidding>>> = [];
    if (buscar && customerId && campaignId) {
      try { provider = await construirLectorCampaignProvider(buscar)(customerId, campaignId, ventana); } catch { /* fail-soft */ }
      try { cambios = await construirLectorCambiosBidding(buscar)(customerId, campaignId, 30); } catch { /* fail-soft */ }
    }
    const nombreVigente = provider.core?.name ?? null;

    // FASES por cambio de estrategia de puja (change-point REAL de Google; sin hardcodear). El cambio MÁS RECIENTE
    // define la fase post-cambio; su día+1 evita mezclar el día del cambio (granularidad diaria de la evolución).
    const cambioReciente = cambios.map((x) => x.at).sort().slice(-1)[0] ?? null;
    const segmentado = cambioReciente != null && provider.evolution.length > 0;
    const changeDate = cambioReciente ? cambioReciente.slice(0, 10) : null;
    const phase2Desde = changeDate ? new Date(Date.parse(`${changeDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : ventana.desde;
    const sum = (dias: typeof provider.evolution) => dias.reduce((a, d) => ({ spend: a.spend + d.spendClp, clicks: a.clicks + d.clicks, impr: a.impr + d.impressions }), { spend: 0, clicks: 0, impr: 0 });
    const evoF1 = segmentado ? provider.evolution.filter((d) => d.date < phase2Desde) : [];
    const evoF2 = segmentado ? provider.evolution.filter((d) => d.date >= phase2Desde) : provider.evolution;
    const s1 = sum(evoF1); const s2 = sum(evoF2);
    const avg = (s: { spend: number; clicks: number }): number | null => (s.clicks > 0 ? Math.round(s.spend / s.clicks) : null);

    // Evidencia (keyword/search-term/device/geo/network) SCOPEADA a la fase relevante (post-cambio) o al total si UNKNOWN.
    const ventanaAnalisis = segmentado ? { desde: phase2Desde, hasta: ventana.hasta } : ventana;
    let ev = { keywords: [], searchTerms: [], devices: [], geos: [], networks: [] } as Awaited<ReturnType<ReturnType<typeof construirLectorEvidenciaGoogle>>>;
    if (buscar && customerId && campaignId) { try { ev = await construirLectorEvidenciaGoogle(buscar)(customerId, campaignId, ventanaAnalisis); } catch { /* fail-soft */ } }

    // Contactos first-party (no phase-scopeados; leads reales atribuibles a la campaña vigente).
    const obs = new ObservacionService(this.store, {} as never);
    let contacts = 0;
    for (const id of await obs.listarIds(c)) {
      const st = await obs.cargar(c, id); const d = st.datos; const p = d?.provenanciaReal;
      if (d?.naturaleza === 'REAL' && p?.provider === 'smileflow-growth' && !p.diagnostico && p.eventName === 'lead_created') contacts += 1;
    }
    const readiness = await this.deps.diagnosis.leerUltima(org);

    // Métricas de la fase ANALIZADA (post-cambio si segmentado; total si UNKNOWN). Search terms REALES del proveedor.
    const spend = segmentado ? s2.spend : (provider.metrics?.spendClp ?? null);
    const clicks = segmentado ? s2.clicks : (provider.metrics?.clicks ?? null);
    const impressions = segmentado ? s2.impr : (provider.metrics?.impressions ?? null);
    const zeroStopClp = envelope.maxSpendWithoutContact;
    const reEnabled = (rid: string): boolean => envelope.stopRules.find((s) => s.id === rid)?.enabled !== false;
    // El stop se evalúa sobre el gasto TOTAL de campaña (la protección no es por fase).
    const spendTotal = provider.metrics?.spendClp ?? null;
    const stopTriggered = reEnabled('STOP_ZERO_CONVERSION') && contacts === 0 && spendTotal != null && spendTotal >= zeroStopClp;
    const periodoTerminado = !!envelope.expiresAt && now >= envelope.expiresAt;

    const phases: PhaseInfo[] = segmentado ? [
      { label: 'PHASE_1', startAt: ventana.desde, endAt: changeDate, biddingStrategy: 'PREVIOUS', maxCpc: null, spend: s1.spend, impressions: s1.impr, clicks: s1.clicks, avgCpcClp: avg(s1) },
      { label: 'PHASE_2', startAt: phase2Desde, endAt: now.slice(0, 10), biddingStrategy: cambios.slice(-1)[0]?.biddingStrategy ?? null, maxCpc: null, spend: s2.spend, impressions: s2.impr, clicks: s2.clicks, avgCpcClp: avg(s2) },
    ] : [];

    const evidencia: EvidenciaExperimento = {
      campaignId, status: provider.core?.status ?? null, periodoTerminado,
      spend, experimentBudgetClp: envelope.experimentBudget, impressions,
      clicks, contacts, conversions: provider.metrics?.conversions ?? null,
      avgCpcClp: clicks && spend != null ? Math.round(spend / clicks) : null,
      ctr: impressions ? Math.round((clicks ?? 0) / impressions * 1000) / 10 : null,
      keywords: ev.keywords, terminos: ev.searchTerms, devices: ev.devices, geos: ev.geos, networks: ev.networks,
      trackingValid: readiness?.firstPartyTracking?.status === 'PASS', landingValid: readiness?.landing?.status === 'PASS',
      zeroContactStopClp: zeroStopClp, stopTriggered, stopRule: stopTriggered ? 'STOP_ZERO_CONVERSION' : null,
      cpcInicialClp: segmentado ? avg(s1) : (avg(sum(provider.evolution.slice(0, 1))) ?? null),
      cpcPosteriorClp: segmentado ? avg(s2) : (clicks && spend != null ? Math.round(spend / clicks) : null),
      phases, phaseSegmentation: segmentado ? 'SEGMENTED' : 'UNKNOWN', analyzedPhaseLabel: segmentado ? 'PHASE_2' : null,
    };
    const experimentId = `${campaignId}:${evidencia.stopRule ?? (periodoTerminado ? 'ended' : 'running')}`;
    return { evidencia, campaignName: nombreVigente, experimentId, diag: { biddingChanges: cambios.length, changePoint: cambioReciente, phase2Desde } };
  }

  /**
   * Un ciclo autónomo. Arma evidencia, analiza y —si el experimento CERRÓ— persiste resultado+learning+notificación
   * (idempotente por experimentId). Devuelve el análisis (o null si no hay campaña). NO escribe en Google.
   */
  async correrCiclo(org: string, ranBy: 'scheduler' | 'endpoint' = 'scheduler'): Promise<{ analisis: AnalisisDirector; persistido: boolean; resumen: Record<string, unknown> } | null> {
    const armado = await this.armarEvidencia(org);
    if (!armado) return null;
    const { evidencia, campaignName, experimentId, diag } = armado;
    const memoria = new ExperimentMemoryService(this.store);
    const aprendizajes = await memoria.aprendizajesPrevios(org, experimentId);
    const analisis = analizarExperimento(evidencia, aprendizajes);
    const cerrado = evidencia.stopTriggered || evidencia.periodoTerminado || evidencia.status === 'PAUSED';
    const resumen = { status: evidencia.status, spend: evidencia.spend, clicks: evidencia.clicks, contacts: evidencia.contacts, keywords: evidencia.keywords.length, terminos: evidencia.terminos.length, stopTriggered: evidencia.stopTriggered, cerrado, experimentId,
      action: analisis.recomendacion.action, approval: analisis.recomendacion.humanApprovalRequired, confidence: analisis.recomendacion.confidence,
      biddingChanges: diag.biddingChanges, changePoint: diag.changePoint, phase2Desde: diag.phase2Desde,
      phaseSeg: analisis.postMortem.phaseSegmentation, phases: analisis.postMortem.phases.length, phase2Spend: analisis.postMortem.phases[1]?.spend ?? null,
      keywordConc: analisis.postMortem.keywordConcentration.map((k) => `${k.keyword}~${Math.round(k.sharePct)}%`),
      visibleTerm: analisis.postMortem.searchTermFindings.map((t) => `${t.termino}~${t.shareCampaignPct ?? '?'}%`), unreportedPct: analisis.postMortem.searchTermPrivacy.unreportedPct };
    if (!cerrado) return { analisis, persistido: false, resumen };

    const c = this.ctx(org); const now = this.ahora();
    // Idempotencia + SUPERSESIÓN: no duplicar el MISMO (experimentId + evidenceVersion); si existe uno de una versión
    // ANTERIOR (evidencia mal agregada), la nueva corrida lo SUPERSEDES (last-wins) sin borrar la auditoría.
    const previo = await this.leerResultado(org);
    if (previo && previo.experimentId === experimentId && previo.evidenceVersion === EVIDENCE_VERSION) {
      return { analisis, persistido: false, resumen: { ...resumen, previoCreatedAt: previo.createdAt, previoRanBy: previo.ranBy, evidenceVersion: EVIDENCE_VERSION } };
    }
    const supersedes = previo && previo.experimentId === experimentId ? previo.createdAt : null;
    const resultado: DirectorResultado = { experimentId, campaignId: evidencia.campaignId, campaignName, status: evidencia.status, createdAt: now, analisis, ranBy, evidenceVersion: EVIDENCE_VERSION, supersedes };
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
