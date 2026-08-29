/**
 * apps/api · campana · READ-MODEL de la CAMPAÑA VIGENTE (PURO). Única fuente de verdad operacional para la UI:
 * resuelve envelope→binding→campaña y compone estado/gasto/rendimiento/stops/monitor. NO ejecuta nada, NO muta,
 * NO cambia reglas: sólo LEE y compone. La campaña histórica se marca aparte (campaignRole) y NUNCA se presenta
 * como vigente ni suma su gasto al experimento. Campos indisponibles ⇒ null (nunca métricas inventadas).
 */
export type CampaignRole = 'ACTIVE' | 'HISTORICAL';

/** Extrae la FECHA CALENDARIO (YYYY-MM-DD) de un valor Google, VERBATIM: toma los primeros 10 caracteres tal cual
 * (la API entrega la fecha en la zona del customer). NUNCA parsea a Date ni convierte a UTC ⇒ no hay off-by-one
 * (28-ago no se vuelve 27-ago). El centinela de "sin fecha de término" de Google (2037-12-30) ⇒ null. */
export function fechaCalendario(v: unknown): string | null {
  if (v == null) return null;
  const d = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d === '2037-12-30' ? null : d;
}

export interface EntradaCampaignLive {
  readonly campaign: { readonly id: string; readonly resourceName: string; readonly name: string | null; readonly status: string | null; readonly channelType: string | null; readonly startDate: string | null; readonly endDate: string | null } | null;
  /** Presupuesto TOTAL de la campaña (experimento) y cap global del envelope. */
  readonly experimentTotalClp: number;
  readonly globalCapClp: number;
  readonly zeroContactStopClp: number;
  readonly authorizedEndDate: string | null; // fin de la ventana (expiresAt o plan)
  readonly stopRulesEnabled: { readonly zeroContact: boolean; readonly budget: boolean; readonly period: boolean; readonly tracking: boolean; readonly landing: boolean };
  /** Métricas provider de LA campaña vigente (no histórica). null ⇒ indisponible. */
  readonly metrics: { readonly spendClp: number | null; readonly impressions: number | null; readonly clicks: number | null; readonly conversions: number | null };
  readonly contacts: number | null;
  readonly evolution: readonly DiaEvolucion[];
  readonly trackingValid: boolean;
  readonly landingAvailable: boolean;
  readonly monitor: { readonly configured: boolean; readonly pauseWired: boolean; readonly intervalSeconds: number; readonly lastTickAt: string | null; readonly lastDecision: string | null; readonly lastDecisionReason: string | null;
    /** Lo que el monitor OBSERVÓ en su último tick (heartbeat enriquecido): estado/gasto/contactos de LA campaña del binding. */
    readonly statusObserved: string | null; readonly spendObserved: number | null; readonly contactsObserved: number | null };
  /** Origen de las fechas mostradas: GOOGLE (provider) o AUTHORIZED (envelope/plan). */
  readonly dateSource: 'GOOGLE' | 'AUTHORIZED' | 'NONE';
  readonly lastGoogleReadAt: string | null;
  readonly lastFirstPartyReadAt: string | null;
  readonly now: string;
  readonly historicalCampaignId: string;
}

/** Datos provider de la campaña vigente (READ-ONLY GAQL, fail-soft por consulta: cada campo indisponible ⇒ null). */
export interface DiaEvolucion { readonly date: string; readonly spendClp: number; readonly clicks: number; readonly impressions: number }
export interface ProviderCampaignData {
  readonly core: { readonly status: string | null; readonly name: string | null; readonly channelType: string | null } | null;
  readonly dates: { readonly startDate: string | null; readonly endDate: string | null } | null;
  readonly metrics: { readonly spendClp: number | null; readonly impressions: number | null; readonly clicks: number | null; readonly conversions: number | null } | null;
  readonly evolution: readonly DiaEvolucion[]; // serie diaria (vacía si aún no hay actividad)
}

/** Lee la campaña vigente por campaignId en consultas GAQL independientes (fail-soft por consulta). El WHERE filtra
 * por campaign.id ⇒ el gasto/rendimiento es EXCLUSIVO de esa campaña (nunca la histórica). Ningún write.
 *
 * SINTAXIS DE FECHA GAQL: en la versión de API que usa SOEC, el filtro de rango es `segments.date BETWEEN 'a' AND 'b'`
 * (ver `gaqlCampanias` en ingesta). El acumulado (lifetime) se obtiene SIN filtro de fecha (ver GAQL_CAMPANIA_SNAPSHOT):
 * devuelve la fila de la campaña aunque no haya actividad ⇒ cost/impresiones/clics = 0 reales (no null). Un `DURING`
 * suelto rompía la consulta (HTTP 400) y hacía que 0 se leyera como null — corregido aquí.
 * `campaign.start_date/end_date` (Google Ads API v25) SÍ se consultan en una query aislada, atributos-solos y filtrada
 * por campaign.id (lo que rompía era la consulta all-time con métricas, no ésta). Vienen como fecha calendario
 * "YYYY-MM-DD" en la zona horaria del customer: se toman VERBATIM (sin parseo/UTC) para NO desplazar 28-ago→27-ago.
 * El centinela de "sin fin" (2037-12-30) se mapea a null. Si la query fallara ⇒ dates=null (fallback en el caller). */
export function construirLectorCampaignProvider(buscar: (customerId: string, query: string) => Promise<Array<Record<string, unknown>>>): (customerId: string, campaignId: string, ventana: { readonly desde: string; readonly hasta: string }) => Promise<ProviderCampaignData> {
  const camp = (rows: Array<Record<string, unknown>>): Record<string, unknown> | undefined => (rows[0] as { campaign?: Record<string, unknown> } | undefined)?.campaign;
  const n = (v: unknown): number => Number(v ?? 0); // 0 válido: la ausencia del campo métrico en una fila devuelta es 0 real
  return async (customerId, campaignId, ventana) => {
    let core: ProviderCampaignData['core'] = null; let dates: ProviderCampaignData['dates'] = null; let metrics: ProviderCampaignData['metrics'] = null; let evolution: DiaEvolucion[] = [];
    try { const c = camp(await buscar(customerId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${campaignId}`)); if (c) core = { status: (c.status as string) ?? null, name: (c.name as string) ?? null, channelType: (c.advertisingChannelType as string) ?? null }; } catch { /* fail-soft */ }
    try { const c = camp(await buscar(customerId, `SELECT campaign.id, campaign.start_date, campaign.end_date FROM campaign WHERE campaign.id = ${campaignId}`)); if (c) { const sd = fechaCalendario(c.startDate); const ed = fechaCalendario(c.endDate); if (sd || ed) dates = { startDate: sd, endDate: ed }; } } catch { /* fail-soft ⇒ dates=null, fallback a fechas autorizadas en el caller */ }
    // Acumulado (lifetime) de LA campaña: sin filtro de fecha ⇒ una fila con métricas totales (0 si aún no sirve). El
    // caller distingue A) Google devolvió fila con 0 ⇒ 0; B) la consulta falló ⇒ metrics=null (indisponible).
    try { const m = (await buscar(customerId, `SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE campaign.id = ${campaignId}`))[0] as { metrics?: Record<string, unknown> } | undefined; const mm = m?.metrics; metrics = { spendClp: n(mm?.costMicros) / 1_000_000, impressions: n(mm?.impressions), clicks: n(mm?.clicks), conversions: n(mm?.conversions) }; } catch { /* fail-soft ⇒ metrics=null (indisponible, NO 0 inventado) */ }
    try { const rows = await buscar(customerId, `SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${ventana.desde}' AND '${ventana.hasta}' ORDER BY segments.date`); evolution = rows.map((r) => { const seg = (r as { segments?: { date?: string } }).segments; const mm = (r as { metrics?: Record<string, unknown> }).metrics; return { date: seg?.date ?? '', spendClp: n(mm?.costMicros) / 1_000_000, clicks: n(mm?.clicks), impressions: n(mm?.impressions) }; }).filter((d) => d.date); } catch { /* fail-soft ⇒ serie vacía */ }
    return { core, dates, metrics, evolution };
  };
}

const div = (a: number | null, b: number | null): number | null => (a != null && b != null && b > 0 ? a / b : null);
const round2 = (n: number | null): number | null => (n == null ? null : Math.round(n * 100) / 100);
const diasHasta = (endDate: string | null, now: string): number | null => {
  if (!endDate) return null;
  // Diferencia en DÍAS CALENDARIO: se comparan sólo las fechas (YYYY-MM-DD, a medianoche UTC), sin la hora del día,
  // para evitar off-by-one (p.ej. 2026-08-29 → 2026-09-06 = 8 días, no 9 por el desfase de horas).
  const d1 = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  const d0 = Date.parse(`${now.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d1) || Number.isNaN(d0) ? null : Math.max(0, Math.round((d1 - d0) / (24 * 3600_000)));
};

function monitorStatus(e: EntradaCampaignLive): 'ACTIVE' | 'STALE' | 'UNAVAILABLE' {
  if (!e.monitor.configured || e.monitor.lastTickAt == null) return 'UNAVAILABLE';
  const reciente = (Date.parse(e.now) - Date.parse(e.monitor.lastTickAt)) < e.monitor.intervalSeconds * 1000 * 2.5;
  return reciente ? 'ACTIVE' : 'STALE';
}

/** Resuelve las fechas de la campaña con PRIORIDAD ESTRICTA: 1) Google (fecha calendario real); 2) ventana de ejecución
 * EXPLÍCITAMENTE materializada del envelope (startsAt/expiresAt, sólo YYYY-MM-DD, sin convertir a UTC); 3) null.
 * PROHIBIDO usar createdAt (no es inicio de campaña; producía 27-ago por off-by-one de zona horaria). */
export function resolverFechasCampania(
  google: { readonly startDate: string | null; readonly endDate: string | null } | null,
  autorizado: { readonly startsAt: string | null; readonly expiresAt: string | null },
): { startDate: string | null; endDate: string | null; dateSource: 'GOOGLE' | 'AUTHORIZED' | 'NONE' } {
  const soloFecha = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null); // YYYY-MM-DD verbatim, sin Date()/UTC
  const gStart = google?.startDate ?? null; const gEnd = google?.endDate ?? null;
  const authStart = soloFecha(autorizado.startsAt); const authEnd = soloFecha(autorizado.expiresAt);
  const startDate = gStart ?? authStart; const endDate = gEnd ?? authEnd;
  const dateSource: 'GOOGLE' | 'AUTHORIZED' | 'NONE' = (gStart || gEnd) ? 'GOOGLE' : (authStart || authEnd) ? 'AUTHORIZED' : 'NONE';
  return { startDate, endDate, dateSource };
}

export function construirCampaignLive(e: EntradaCampaignLive): Record<string, unknown> {
  const spend = e.metrics.spendClp;
  const contacts = e.contacts;
  const totalContactos = contacts ?? 0;
  // Stops (sólo VISUALIZACIÓN de reglas existentes; sin cambiar thresholds).
  const zeroTriggered = e.stopRulesEnabled.zeroContact && totalContactos === 0 && spend != null && spend >= e.zeroContactStopClp;
  const budgetTriggered = e.stopRulesEnabled.budget && spend != null && spend >= e.globalCapClp;
  const periodTriggered = e.stopRulesEnabled.period && !!e.authorizedEndDate && e.now >= e.authorizedEndDate;
  return {
    ok: e.campaign !== null,
    campaign: e.campaign ? { ...e.campaign, campaignRole: 'ACTIVE' as CampaignRole, dateSource: e.dateSource } : null,
    budget: {
      totalClp: e.experimentTotalClp,
      spentClp: spend,
      remainingClp: spend == null ? null : Math.max(0, e.experimentTotalClp - spend),
      spentPercent: spend == null ? null : round2((spend / e.experimentTotalClp) * 100),
    },
    performance: {
      impressions: e.metrics.impressions,
      clicks: e.metrics.clicks,
      ctr: round2(div(e.metrics.clicks, e.metrics.impressions) != null ? (div(e.metrics.clicks, e.metrics.impressions) as number) * 100 : null),
      averageCpcClp: round2(div(spend, e.metrics.clicks)),
      contacts,
      conversions: e.metrics.conversions,
      costPerContactClp: round2(div(spend, contacts)),
    },
    stops: {
      zeroContact: { enabled: e.stopRulesEnabled.zeroContact, thresholdClp: e.zeroContactStopClp, currentSpendClp: spend, remainingUntilStopClp: spend == null ? null : Math.max(0, e.zeroContactStopClp - spend), triggered: zeroTriggered, hasContact: totalContactos >= 1 },
      budget: { enabled: e.stopRulesEnabled.budget, capClp: e.globalCapClp, currentSpendClp: spend, remainingClp: spend == null ? null : Math.max(0, e.globalCapClp - spend), triggered: budgetTriggered },
      period: { enabled: e.stopRulesEnabled.period, endDate: e.authorizedEndDate, remainingDays: diasHasta(e.authorizedEndDate, e.now), triggered: periodTriggered },
      tracking: { enabled: e.stopRulesEnabled.tracking, valid: e.trackingValid, triggered: e.stopRulesEnabled.tracking && !e.trackingValid },
      landing: { enabled: e.stopRulesEnabled.landing, available: e.landingAvailable, triggered: e.stopRulesEnabled.landing && !e.landingAvailable },
    },
    monitor: {
      // ACTIVA sólo con EVIDENCIA de tick reciente (< 2.5 intervalos); sin config o sin tick ⇒ UNAVAILABLE; tick viejo ⇒ STALE.
      active: monitorStatus(e) === 'ACTIVE',
      status: monitorStatus(e),
      intervalSeconds: e.monitor.intervalSeconds,
      pauseWired: e.monitor.pauseWired,
      lastTickAt: e.monitor.lastTickAt,
      lastDecision: e.monitor.lastDecision,
      lastDecisionReason: e.monitor.lastDecisionReason,
      // Evidencia del último tick: qué observó realmente el monitor (para explicar sin ocultar cualquier desfase con
      // el estado leído AHORA por este read-model). null hasta que un tick registre estos campos enriquecidos.
      campaignStatusObserved: e.monitor.statusObserved,
      spendObserved: e.monitor.spendObserved,
      contactsObserved: e.monitor.contactsObserved,
    },
    evolution: e.evolution,
    sync: { lastGoogleReadAt: e.lastGoogleReadAt, lastFirstPartyReadAt: e.lastFirstPartyReadAt },
    historical: { id: e.historicalCampaignId, campaignRole: 'HISTORICAL' as CampaignRole, note: 'Campaña histórica; su gasto NO forma parte del experimento vigente.' },
  };
}
