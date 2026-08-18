/**
 * apps/api · MODELO DE CONOCIMIENTO del Director sobre datos Meta reales.
 *
 * Transforma snapshots normalizados (current + histórico) en inteligencia comercial TRAZABLE y honesta:
 *   FACT · DERIVED_METRIC · SIGNAL · HYPOTHESIS · RECOMMENDATION.
 *
 * Epistemología obligatoria:
 *   · nunca presentar SIGNAL/HYPOTHESIS como FACT; nunca correlación⇒causalidad;
 *   · si faltan datos, decirlo (item explícito); si freshness es mala, advertirlo;
 *   · si el histórico es insuficiente, NO inventar tendencia (dirección UNKNOWN);
 *   · sin benchmarks inventados; sin juicios "bueno/malo" absolutos sin baseline;
 *   · sin ROI/conversiones si no hay datos de ingresos (se declara la frontera de capacidad).
 * Función PURA sobre lo persistido; no llama a Graph; nunca token/secret/raw/paging/PII.
 */

import type { VistaDirectorMeta } from './meta-director';
import type { CapacidadSync, Freshness, SnapshotSync } from './meta-sync';

export type TipoConocimiento = 'FACT' | 'DERIVED_METRIC' | 'SIGNAL' | 'HYPOTHESIS' | 'RECOMMENDATION';
export type Confianza = 'HIGH' | 'MEDIUM' | 'LOW';
export type Prioridad = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Direccion = 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';

export interface ItemConocimiento {
  readonly id: string;
  readonly type: TipoConocimiento;
  readonly title: string;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly sourceCapabilities: readonly CapacidadSync[];
  readonly capturedAt: string | null;
  readonly freshness: Freshness | null;
  readonly confidence: Confianza;
  readonly priority: Prioridad;
  readonly direction?: Direccion;
  readonly delta?: number;
  readonly deltaPct?: number | null;
}

export interface Conocimiento {
  readonly organizationId: string;
  readonly generatedAt: string;
  readonly health: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly overview: string;
  readonly facts: readonly ItemConocimiento[];
  readonly metrics: readonly ItemConocimiento[];
  readonly signals: readonly ItemConocimiento[];
  readonly hypotheses: readonly ItemConocimiento[];
  readonly recommendations: readonly ItemConocimiento[];
  readonly priorities: readonly ItemConocimiento[];
}

const RANGO_PRIORIDAD: Record<Prioridad, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

/** Confianza base según freshness (dato observado). STALE ⇒ baja; NEVER/DEGRADED ⇒ sin confianza alta. */
function confianzaPorFreshness(f: Freshness | null): Confianza {
  if (f === 'FRESH') return 'HIGH';
  if (f === 'STALE') return 'MEDIUM';
  return 'LOW';
}

export interface Comparacion {
  readonly direction: Direccion;
  readonly delta: number;
  readonly deltaPct: number | null; // null si previo=0 (no dividir por cero / % engañoso)
}

/** Compara dos valores numéricos; dirección + delta + % (null si previo=0). */
export function compararMetrica(actual: number, previo: number | null): Comparacion {
  if (previo === null) return { direction: 'UNKNOWN', delta: 0, deltaPct: null };
  const delta = actual - previo;
  const direction: Direccion = delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'STABLE';
  const deltaPct = previo === 0 ? null : Math.round((delta / previo) * 1000) / 10;
  return { direction, delta, deltaPct };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Etiqueta humana del período de insights. Nunca inventa: si no hay etiqueta, dice "el período consultado". */
function periodoHumano(periodo: string | undefined): string {
  switch (periodo) {
    case 'LAST_7D': return 'los últimos 7 días';
    case 'TODAY': return 'hoy';
    case 'LAST_30D': return 'los últimos 30 días';
    default: return 'el período consultado';
  }
}

/** Extrae el valor numérico comparable de un snapshot para una métrica dada (count o métrica). */
function valorMetrica(snap: SnapshotSync | undefined, metrica: string): number | null {
  if (!snap) return null;
  if (metrica === 'count') return num(snap.resumen.count);
  return num(snap.resumen.metrics?.[metrica]);
}

/** Previo comparable: el snapshot de histórico inmediatamente anterior al current (mismo capability). */
function previoComparable(historial: readonly SnapshotSync[], capability: CapacidadSync, externalId: string, capturedAt: string | null): SnapshotSync | undefined {
  if (capturedAt === null) return undefined;
  const capMs = Date.parse(capturedAt);
  return historial
    .filter((s) => s.capability === capability && s.externalId === externalId && Date.parse(s.observedAt) < capMs)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
}

const EV = (snap: { capability: string; observedAt?: string | null; capturedAt?: string | null; resumen?: unknown }): string =>
  `${snap.capability} @ ${snap.observedAt ?? snap.capturedAt ?? 'sin captura'}: ${JSON.stringify(snap.resumen ?? {})}`;

/**
 * Construye el conocimiento del Director a partir de la vista (current) + histórico. Determinista y trazable.
 */
export function construirConocimiento(vista: VistaDirectorMeta, historial: readonly SnapshotSync[], ahora: string): Conocimiento {
  const items: ItemConocimiento[] = [];
  const cap = (c: CapacidadSync) => vista.capacidades.find((x) => x.capability === c);
  const push = (it: ItemConocimiento) => items.push(it);

  // --- Salud de la conexión (SIGNAL + RECOMMENDATION) --------------------------------------------
  const health = vista.health;
  if (health === 'TOKEN_EXPIRED' || health === 'REAUTH_REQUIRED') {
    push({ id: 'signal:health:reauth', type: 'SIGNAL', title: 'La conexión con Meta necesita reautorizarse', summary: 'El acceso a Meta expiró o fue revocado. Mientras tanto, los datos no se actualizan.', evidence: [`health=${health}`], sourceCapabilities: [], capturedAt: vista.lastSuccessfulSyncAt, freshness: null, confidence: 'HIGH', priority: 'CRITICAL' });
    push({ id: 'reco:health:reauth', type: 'RECOMMENDATION', title: 'Reconectá tu cuenta de Meta', summary: 'Volvé a autorizar la conexión para que SOEC siga leyendo tus datos.', evidence: [`health=${health}`], sourceCapabilities: [], capturedAt: null, freshness: null, confidence: 'HIGH', priority: 'CRITICAL' });
  } else if (health === 'SCOPE_MISSING') {
    push({ id: 'signal:health:scope', type: 'SIGNAL', title: 'Faltan permisos de lectura en Meta', summary: 'Algunas lecturas fueron rechazadas por permisos. Parte de la información puede faltar.', evidence: [`health=${health}`], sourceCapabilities: [], capturedAt: null, freshness: null, confidence: 'HIGH', priority: 'HIGH' });
    push({ id: 'reco:health:scope', type: 'RECOMMENDATION', title: 'Revisá los permisos concedidos a SOEC en Meta', summary: 'Reautorizá otorgando los permisos de lectura solicitados.', evidence: [`health=${health}`], sourceCapabilities: [], capturedAt: null, freshness: null, confidence: 'MEDIUM', priority: 'HIGH' });
  } else if (health === 'DEGRADED') {
    push({ id: 'signal:health:degraded', type: 'SIGNAL', title: 'La conexión con Meta está degradada', summary: 'Hubo errores temporales al leer algunos datos; SOEC reintentará automáticamente.', evidence: [`health=${health}`], sourceCapabilities: [], capturedAt: null, freshness: null, confidence: 'MEDIUM', priority: 'HIGH' });
  }

  // --- Instagram ---------------------------------------------------------------------------------
  const igId = cap('INSTAGRAM_IDENTITY');
  if (igId?.resumen?.identity?.['username']) {
    push({ id: 'fact:ig:identity', type: 'FACT', title: `Instagram conectado: @${igId.resumen.identity['username']}`, summary: 'SOEC está leyendo la cuenta de Instagram vinculada.', evidence: [EV(igId)], sourceCapabilities: ['INSTAGRAM_IDENTITY'], capturedAt: igId.capturedAt, freshness: igId.freshness, confidence: confianzaPorFreshness(igId.freshness), priority: 'INFO' });
  }
  const igMedia = cap('INSTAGRAM_MEDIA');
  if (igMedia) {
    const c = num(igMedia.resumen?.count) ?? 0;
    push({ id: 'fact:ig:media', type: 'FACT', title: `${c} publicaciones observadas en Instagram`, summary: c === 0 ? 'No se observaron publicaciones recientes en la cuenta.' : `Se observaron ${c} publicaciones en la cuenta de Instagram.`, evidence: [EV(igMedia)], sourceCapabilities: ['INSTAGRAM_MEDIA'], capturedAt: igMedia.capturedAt, freshness: igMedia.freshness, confidence: confianzaPorFreshness(igMedia.freshness), priority: 'INFO' });
    const prev = previoComparable(historial, 'INSTAGRAM_MEDIA', igMedia.externalId, igMedia.capturedAt);
    const cmp = compararMetrica(c, valorMetrica(prev, 'count'));
    if (cmp.direction !== 'UNKNOWN') {
      push({ id: 'metric:ig:media:delta', type: 'DERIVED_METRIC', title: 'Cambio en publicaciones de Instagram', summary: cmp.direction === 'STABLE' ? 'La cantidad de publicaciones se mantuvo respecto a la lectura anterior.' : `Las publicaciones ${cmp.direction === 'UP' ? 'aumentaron' : 'disminuyeron'} en ${Math.abs(cmp.delta)} respecto a la lectura anterior.`, evidence: [EV(igMedia), prev ? EV({ capability: 'INSTAGRAM_MEDIA', observedAt: prev.observedAt, resumen: prev.resumen }) : 'sin previo'], sourceCapabilities: ['INSTAGRAM_MEDIA'], capturedAt: igMedia.capturedAt, freshness: igMedia.freshness, confidence: 'MEDIUM', priority: 'LOW', direction: cmp.direction, delta: cmp.delta, deltaPct: cmp.deltaPct });
    }
  }
  const igIns = cap('INSTAGRAM_INSIGHTS');
  if (igIns) {
    const reach = num(igIns.resumen?.metrics?.['reach']);
    if (reach === null || (igIns.resumen?.metrics && Object.keys(igIns.resumen.metrics).length === 0)) {
      push({ id: 'signal:ig:insights:nodata', type: 'SIGNAL', title: 'Sin datos de alcance de Instagram', summary: 'Meta no devolvió métricas de alcance para el período leído. No es un error: puede no haber datos suficientes todavía.', evidence: [EV(igIns)], sourceCapabilities: ['INSTAGRAM_INSIGHTS'], capturedAt: igIns.capturedAt, freshness: igIns.freshness, confidence: 'MEDIUM', priority: 'LOW' });
    } else {
      push({ id: 'fact:ig:reach', type: 'FACT', title: `Alcance de Instagram (día): ${reach}`, summary: 'Alcance observado en el período más reciente.', evidence: [EV(igIns)], sourceCapabilities: ['INSTAGRAM_INSIGHTS'], capturedAt: igIns.capturedAt, freshness: igIns.freshness, confidence: confianzaPorFreshness(igIns.freshness), priority: 'INFO' });
      const prev = previoComparable(historial, 'INSTAGRAM_INSIGHTS', igIns.externalId, igIns.capturedAt);
      const cmp = compararMetrica(reach, valorMetrica(prev, 'reach'));
      if (cmp.direction === 'DOWN') {
        push({ id: 'hyp:ig:reach:down', type: 'HYPOTHESIS', title: 'El alcance de Instagram podría estar bajando', summary: 'El alcance disminuyó respecto a la lectura anterior. Podría deberse a menor frecuencia o cambios de contenido; es una hipótesis, no una causa confirmada.', evidence: [EV(igIns)], sourceCapabilities: ['INSTAGRAM_INSIGHTS'], capturedAt: igIns.capturedAt, freshness: igIns.freshness, confidence: 'LOW', priority: 'MEDIUM', direction: 'DOWN', delta: cmp.delta, deltaPct: cmp.deltaPct });
      }
    }
  }

  // --- Ads ---------------------------------------------------------------------------------------
  const adAcc = cap('ADS_ACCOUNT');
  if (adAcc?.resumen?.identity) {
    const moneda = adAcc.resumen.identity['currency'];
    push({ id: 'fact:ads:account', type: 'FACT', title: `Cuenta publicitaria conectada${moneda ? ` (${moneda})` : ''}`, summary: 'SOEC está leyendo la cuenta de anuncios vinculada.', evidence: [EV(adAcc)], sourceCapabilities: ['ADS_ACCOUNT'], capturedAt: adAcc.capturedAt, freshness: adAcc.freshness, confidence: confianzaPorFreshness(adAcc.freshness), priority: 'INFO' });
  }
  const adCamp = cap('ADS_CAMPAIGNS');
  const campCount = adCamp ? (num(adCamp.resumen?.count) ?? 0) : 0;
  const entregando = adCamp ? (num(adCamp.resumen?.entregando) ?? 0) : 0;
  if (adCamp) {
    const detalle = campCount === 0 ? 'No se observan campañas en la cuenta.' : `Se observan ${campCount} campañas${entregando > 0 ? `, ${entregando} activa(s)` : ', ninguna activa (todas pausadas o sin entrega)'}.`;
    push({ id: 'fact:ads:campaigns', type: 'FACT', title: `${campCount} campañas${entregando > 0 ? ` · ${entregando} activa(s)` : ''}`, summary: detalle, evidence: [EV(adCamp)], sourceCapabilities: ['ADS_CAMPAIGNS'], capturedAt: adCamp.capturedAt, freshness: adCamp.freshness, confidence: confianzaPorFreshness(adCamp.freshness), priority: 'INFO' });
    if (campCount === 0) {
      push({ id: 'signal:ads:nocampaigns', type: 'SIGNAL', title: 'No hay campañas visibles', summary: 'La cuenta de anuncios no muestra campañas. Puede ser correcto si no estás pautando ahora.', evidence: [EV(adCamp)], sourceCapabilities: ['ADS_CAMPAIGNS'], capturedAt: adCamp.capturedAt, freshness: adCamp.freshness, confidence: 'MEDIUM', priority: 'MEDIUM' });
    }
  }
  const adIns = cap('ADS_INSIGHTS');
  if (adIns) {
    const m = adIns.resumen?.metrics ?? {};
    const periodo = periodoHumano(adIns.resumen?.periodo);
    if (Object.keys(m).length === 0) {
      // No-data NUNCA se convierte en 0. Si además hay campañas configuradas, se dice explícito con período.
      const conCampanas = campCount > 0;
      push({
        id: 'signal:ads:insights:nodata', type: 'SIGNAL',
        title: conCampanas ? 'Campañas configuradas, pero sin entrega' : 'Sin métricas de inversión publicitaria',
        summary: conCampanas
          ? `Hay ${campCount} campañas configuradas, pero Meta no registra impresiones, clics ni gasto en ${periodo}. No se puede calcular rendimiento con estos datos.`
          : `Meta no devolvió impresiones/clics/gasto en ${periodo}. Suele ocurrir cuando no hay inversión reciente. No se puede calcular rendimiento con estos datos.`,
        evidence: [EV(adIns)], sourceCapabilities: ['ADS_INSIGHTS'], capturedAt: adIns.capturedAt, freshness: adIns.freshness, confidence: 'MEDIUM', priority: conCampanas ? 'MEDIUM' : 'LOW',
      });
    } else {
      const imp = num(m['impressions']) ?? 0;
      push({ id: 'fact:ads:insights', type: 'FACT', title: `Actividad de anuncios: ${imp} impresiones`, summary: `Métricas de anuncios observadas en ${periodo} (Meta).`, evidence: [EV(adIns)], sourceCapabilities: ['ADS_INSIGHTS'], capturedAt: adIns.capturedAt, freshness: adIns.freshness, confidence: confianzaPorFreshness(adIns.freshness), priority: 'INFO' });
    }
  }

  // --- Frontera de capacidad: sin ROI (honestidad) ----------------------------------------------
  push({ id: 'info:no-roi', type: 'FACT', title: 'Aún no se calcula retorno de inversión', summary: 'SOEC lee la actividad de Meta, pero todavía no hay datos de ingresos/conversiones conectados para calcular ROI. No se estima retorno sin esos datos.', evidence: ['sin fuente de ingresos/conversiones'], sourceCapabilities: [], capturedAt: null, freshness: null, confidence: 'HIGH', priority: 'INFO' });

  // --- Freshness / faltantes ---------------------------------------------------------------------
  const stale = vista.capacidades.filter((c) => c.freshness === 'STALE');
  if (stale.length > 0) {
    push({ id: 'signal:freshness:stale', type: 'SIGNAL', title: 'Algunos datos están por actualizarse', summary: `${stale.length} tipo(s) de dato superaron su ventana de frescura. SOEC los actualiza automáticamente en la próxima sincronización.`, evidence: stale.map((c) => `${c.capability} (${c.freshness})`), sourceCapabilities: stale.map((c) => c.capability), capturedAt: null, freshness: 'STALE', confidence: 'HIGH', priority: 'LOW' });
  }
  const never = vista.capacidades.filter((c) => c.freshness === 'NEVER_SYNCED');
  if (never.length > 0) {
    push({ id: 'signal:freshness:never', type: 'SIGNAL', title: 'Hay datos que aún no se sincronizaron', summary: `${never.length} tipo(s) de dato todavía no tienen una primera lectura.`, evidence: never.map((c) => c.capability), sourceCapabilities: never.map((c) => c.capability), capturedAt: null, freshness: 'NEVER_SYNCED', confidence: 'HIGH', priority: 'MEDIUM' });
  }

  // --- Ensamblado + prioridades ------------------------------------------------------------------
  const porTipo = (t: TipoConocimiento) => items.filter((i) => i.type === t);
  const priorities = [...items].filter((i) => i.priority !== 'INFO').sort((a, b) => RANGO_PRIORIDAD[a.priority] - RANGO_PRIORIDAD[b.priority]).slice(0, 6);

  const overview = construirOverview(vista, items);

  return {
    organizationId: vista.organizationId,
    generatedAt: ahora,
    health,
    lastSuccessfulSyncAt: vista.lastSuccessfulSyncAt,
    overview,
    facts: porTipo('FACT'),
    metrics: porTipo('DERIVED_METRIC'),
    signals: porTipo('SIGNAL'),
    hypotheses: porTipo('HYPOTHESIS'),
    recommendations: porTipo('RECOMMENDATION'),
    priorities,
  };
}

function construirOverview(vista: VistaDirectorMeta, items: readonly ItemConocimiento[]): string {
  const criticos = items.filter((i) => i.priority === 'CRITICAL').length;
  const altos = items.filter((i) => i.priority === 'HIGH').length;
  if (criticos > 0) return 'Tu conexión con Meta necesita atención inmediata (reautorización). Mientras tanto, los datos no se actualizan.';
  const partes: string[] = [];
  if (vista.health === 'HEALTHY') partes.push('Meta está conectado y saludable.');
  else partes.push(`Estado de la conexión: ${vista.health}.`);
  const igMedia = vista.capacidades.find((c) => c.capability === 'INSTAGRAM_MEDIA');
  if (igMedia?.resumen?.count !== undefined) partes.push(`Instagram: ${igMedia.resumen.count} publicaciones observadas.`);
  const adCamp = vista.capacidades.find((c) => c.capability === 'ADS_CAMPAIGNS');
  if (adCamp?.resumen?.count !== undefined) partes.push(`Anuncios: ${adCamp.resumen.count} campañas visibles.`);
  if (altos > 0) partes.push(`Hay ${altos} punto(s) que requieren tu atención.`);
  else partes.push('No hay alertas urgentes hoy.');
  return partes.join(' ');
}
