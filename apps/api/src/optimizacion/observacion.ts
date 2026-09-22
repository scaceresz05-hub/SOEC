/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · observación (lecturas READ-ONLY).
 *
 * Construye el SNAPSHOT INMUTABLE que sostiene cada decisión: si mañana alguien pregunta «¿por qué pausaste
 * eso?», la respuesta es esta foto, con su ventana, su fuente y hasta dónde llegaban los datos del proveedor.
 *
 * DOS REGLAS:
 *  · **Una métrica que no existe es `null`, nunca cero.** Cero clics y «no sabemos cuántos clics» llevan a
 *    decisiones opuestas; confundirlos es cómo se pausa una campaña que estaba bien.
 *  · **Una sola consulta por ciclo.** El mismo snapshot sirve al director, al optimizador y a la pantalla. El
 *    camino de seguridad conserva su lectura propia porque necesita frescura independiente.
 */
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { deMicros } from '../dinero';
import type { RendimientoEntidad, RendimientoPalabra, RendimientoTermino, SnapshotObservacion } from './optimizacion-pg';
import {
  VENTANA_DIAS_POR_DEFECTO,
  derivar,
  type MetricaOpcional,
  type SaludMedicion,
  type VentanaObservacion,
} from './optimizacion-tipos';

type ClienteLectura = Pick<GoogleAdsMutateHttpClient, 'buscar'>;

/** Convierte un valor del proveedor a número, o `null` si no vino. Jamás devuelve 0 por ausencia. */
const n = (v: unknown): MetricaOpcional => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/**
 * Micros de la plataforma → unidades MENORES de la moneda del negocio. `null` si no hay dato.
 *
 * La conversión NO es siempre dividir por un millón: eso sólo vale en monedas SIN decimales (CLP, JPY). En
 * euros o dólares, un millón de micros es 1,00 —es decir, 100 unidades menores—, y confundirlo haría que SOEC
 * leyera un gasto cien veces menor del real y decidiera sobre él.
 */
const enMenores = (v: unknown, moneda: string): MetricaOpcional => deMicros(n(v), moneda);
const suma = (a: MetricaOpcional, b: MetricaOpcional): MetricaOpcional => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export function ventanaDe(ahora: string, dias = VENTANA_DIAS_POR_DEFECTO): VentanaObservacion {
  const hasta = new Date(Date.parse(ahora) - 24 * 3_600_000); // los datos de hoy aún se están consolidando
  const desde = new Date(hasta.getTime() - (dias - 1) * 24 * 3_600_000);
  return { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10), dias };
}

export interface EntradaObservacion {
  readonly organizationId: string;
  readonly cicloId: string;
  readonly cliente: ClienteLectura;
  readonly customerId: string;
  readonly campaignId: string;
  readonly ventana: VentanaObservacion;
  readonly saludMedicion: SaludMedicion;
  /** Moneda ISO del negocio: sin ella no se pueden leer los importes de la plataforma sin suponer. */
  readonly moneda: string;
  readonly ahora: string;
  readonly log?: (info: Record<string, unknown>) => void;
}

/**
 * Lee la campaña y sus entidades. Cada consulta es independiente y fail-soft: que falle la de anuncios no
 * puede dejar sin snapshot a la de palabras. Lo que no se pudo leer queda como `null`, y el portero de
 * evidencia decidirá si con eso alcanza para algo.
 */
export async function observar(e: EntradaObservacion): Promise<SnapshotObservacion> {
  const wc = `campaign.id = ${e.campaignId} AND segments.date BETWEEN '${e.ventana.desde}' AND '${e.ventana.hasta}'`;
  const id = `snap-${e.cicloId}`;

  let campania: SnapshotObservacion['campania'] = {
    ...derivar({ spend: null, impressions: null, clicks: null, conversions: null, conversionValue: null }),
    estado: null, presupuestoDiarioMicros: null,
  };
  let datosHasta: string | null = null;

  try {
    const filas = await e.cliente.buscar(
      e.customerId,
      `SELECT campaign.status, campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions,
              metrics.clicks, metrics.conversions, metrics.conversions_value, segments.date
       FROM campaign WHERE ${wc}`,
    );
    let spend: MetricaOpcional = null; let impressions: MetricaOpcional = null; let clicks: MetricaOpcional = null;
    let conversions: MetricaOpcional = null; let conversionValue: MetricaOpcional = null;
    let estado: string | null = null; let presupuesto: number | null = null;
    for (const f of filas) {
      const m = (f as { metrics?: Record<string, unknown> }).metrics ?? {};
      spend = suma(spend, enMenores(m.costMicros, e.moneda));
      impressions = suma(impressions, n(m.impressions));
      clicks = suma(clicks, n(m.clicks));
      conversions = suma(conversions, n(m.conversions));
      conversionValue = suma(conversionValue, n(m.conversionsValue));
      estado = String((f as { campaign?: { status?: unknown } }).campaign?.status ?? estado ?? '') || estado;
      const b = n((f as { campaignBudget?: { amountMicros?: unknown } }).campaignBudget?.amountMicros);
      if (b !== null) presupuesto = b;
      const fecha = (f as { segments?: { date?: string } }).segments?.date ?? null;
      if (fecha !== null && (datosHasta === null || fecha > datosHasta)) datosHasta = fecha;
    }
    campania = { ...derivar({ spend, impressions, clicks, conversions, conversionValue }), estado, presupuestoDiarioMicros: presupuesto };
  } catch {
    // fail-soft: queda todo en UNKNOWN y la evidencia será insuficiente. Mejor eso que inventar ceros.
  }

  const grupos = await leerEntidades(e, `SELECT ad_group.id, ad_group.name, ad_group.status, metrics.cost_micros,
    metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group WHERE ${wc}`, (f) => {
    const g = (f as { adGroup?: Record<string, unknown> }).adGroup ?? {};
    return { id: String(g.id ?? ''), nombre: String(g.name ?? ''), estado: String(g.status ?? '') || null };
  });

  const anuncios = await leerEntidades(e, `SELECT ad_group_ad.ad.id, ad_group_ad.status, metrics.cost_micros,
    metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${wc}`, (f) => {
    const a = (f as { adGroupAd?: { ad?: { id?: unknown }; status?: unknown } }).adGroupAd ?? {};
    return { id: String(a.ad?.id ?? ''), nombre: `anuncio ${String(a.ad?.id ?? '')}`, estado: String(a.status ?? '') || null };
  });

  const palabras = await leerPalabras(e, wc);
  const terminos = await leerTerminos(e, wc);

  e.log?.({ optimizacion: 'observacion', org: e.organizationId, campaña: e.campaignId, palabras: palabras.length, terminos: terminos.length, datosHasta });

  return {
    organizationId: e.organizationId, id, cicloId: e.cicloId, proveedor: 'GOOGLE_ADS', campaignId: e.campaignId,
    ventana: e.ventana, campania, gruposAnuncio: grupos, palabras, terminos, anuncios,
    saludMedicion: e.saludMedicion, fuente: 'GOOGLE_ADS_API',
    datosHasta: datosHasta === null ? null : `${datosHasta}T23:59:59.000Z`,
    observadoEn: e.ahora,
  };
}

async function leerEntidades(
  e: EntradaObservacion,
  gaql: string,
  clave: (f: Record<string, unknown>) => { id: string; nombre: string; estado: string | null },
): Promise<readonly RendimientoEntidad[]> {
  try {
    const filas = await e.cliente.buscar(e.customerId, gaql);
    const agg = new Map<string, { nombre: string; estado: string | null; spend: MetricaOpcional; impressions: MetricaOpcional; clicks: MetricaOpcional; conversions: MetricaOpcional }>();
    for (const f of filas) {
      const k = clave(f);
      if (k.id === '') continue;
      const m = (f as { metrics?: Record<string, unknown> }).metrics ?? {};
      const acc = agg.get(k.id) ?? { nombre: k.nombre, estado: k.estado, spend: null, impressions: null, clicks: null, conversions: null };
      acc.spend = suma(acc.spend, enMenores(m.costMicros, e.moneda));
      acc.impressions = suma(acc.impressions, n(m.impressions));
      acc.clicks = suma(acc.clicks, n(m.clicks));
      acc.conversions = suma(acc.conversions, n(m.conversions));
      agg.set(k.id, acc);
    }
    return [...agg.entries()].map(([id, v]) => ({
      id, nombre: v.nombre, estado: v.estado,
      ...derivar({ spend: v.spend, impressions: v.impressions, clicks: v.clicks, conversions: v.conversions, conversionValue: null }),
    }));
  } catch {
    return [];
  }
}

async function leerPalabras(e: EntradaObservacion, wc: string): Promise<readonly RendimientoPalabra[]> {
  try {
    const filas = await e.cliente.buscar(
      e.customerId,
      `SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
              ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros,
              metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
       FROM keyword_view WHERE ${wc}`,
    );
    const agg = new Map<string, RendimientoPalabra & { _spend: MetricaOpcional }>();
    for (const f of filas) {
      const c = (f as { adGroupCriterion?: { criterionId?: unknown; keyword?: { text?: string; matchType?: string }; status?: unknown; cpcBidMicros?: unknown } }).adGroupCriterion ?? {};
      const texto = c.keyword?.text ?? '';
      if (texto === '') continue;
      const criterionId = c.criterionId === undefined ? null : String(c.criterionId);
      const adGroupId = String((f as { adGroup?: { id?: unknown } }).adGroup?.id ?? '') || null;
      const clave = `${adGroupId}:${criterionId}:${texto}`;
      const m = (f as { metrics?: Record<string, unknown> }).metrics ?? {};
      const previo = agg.get(clave);
      const spend = suma(previo?.spend ?? null, enMenores(m.costMicros, e.moneda));
      const impressions = suma(previo?.impressions ?? null, n(m.impressions));
      const clicks = suma(previo?.clicks ?? null, n(m.clicks));
      const conversions = suma(previo?.conversions ?? null, n(m.conversions));
      agg.set(clave, {
        adGroupId, criterionId, texto, concordancia: c.keyword?.matchType ?? null,
        estado: c.status === undefined ? null : String(c.status),
        cpcMaximoMicros: n(c.cpcBidMicros),
        ...derivar({ spend, impressions, clicks, conversions, conversionValue: null }),
        _spend: spend,
      });
    }
    return [...agg.values()].map(({ _spend, ...k }) => k);
  } catch {
    return [];
  }
}

async function leerTerminos(e: EntradaObservacion, wc: string): Promise<readonly RendimientoTermino[]> {
  try {
    const filas = await e.cliente.buscar(
      e.customerId,
      `SELECT search_term_view.search_term, segments.keyword.info.text, metrics.cost_micros, metrics.impressions,
              metrics.clicks, metrics.conversions FROM search_term_view WHERE ${wc}`,
    );
    const agg = new Map<string, { palabra: string | null; spend: MetricaOpcional; impressions: MetricaOpcional; clicks: MetricaOpcional; conversions: MetricaOpcional }>();
    for (const f of filas) {
      const termino = (f as { searchTermView?: { searchTerm?: string } }).searchTermView?.searchTerm ?? '';
      if (termino === '') continue;
      const m = (f as { metrics?: Record<string, unknown> }).metrics ?? {};
      const palabra = (f as { segments?: { keyword?: { info?: { text?: string } } } }).segments?.keyword?.info?.text ?? null;
      const acc = agg.get(termino) ?? { palabra, spend: null, impressions: null, clicks: null, conversions: null };
      acc.spend = suma(acc.spend, enMenores(m.costMicros, e.moneda));
      acc.impressions = suma(acc.impressions, n(m.impressions));
      acc.clicks = suma(acc.clicks, n(m.clicks));
      acc.conversions = suma(acc.conversions, n(m.conversions));
      agg.set(termino, acc);
    }
    return [...agg.entries()].map(([termino, v]) => ({
      termino, palabraQueLoDisparo: v.palabra,
      ...derivar({ spend: v.spend, impressions: v.impressions, clicks: v.clicks, conversions: v.conversions, conversionValue: null }),
    }));
  } catch {
    return [];
  }
}

/** Negativas ya aplicadas en la campaña: lo que ya está excluido no se vuelve a proponer. */
export async function leerNegativasExistentes(cliente: ClienteLectura, customerId: string, campaignId: string): Promise<readonly string[]> {
  try {
    const filas = await cliente.buscar(
      customerId,
      `SELECT campaign_criterion.keyword.text FROM campaign_criterion
       WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'KEYWORD'
       AND campaign_criterion.negative = true AND campaign_criterion.status != 'REMOVED'`,
    );
    return filas
      .map((f) => ((f as { campaignCriterion?: { keyword?: { text?: string } } }).campaignCriterion?.keyword?.text ?? ''))
      .filter((t) => t !== '');
  } catch {
    return [];
  }
}

/** Estrategia de puja vigente: determina si tiene sentido tocar el techo de CPC. */
export async function leerEstrategiaDePuja(cliente: ClienteLectura, customerId: string, campaignId: string): Promise<string | null> {
  try {
    const filas = await cliente.buscar(customerId, `SELECT campaign.bidding_strategy_type FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`);
    const v = (filas[0] as { campaign?: { biddingStrategyType?: unknown } } | undefined)?.campaign?.biddingStrategyType;
    return v === undefined || v === null ? null : String(v);
  } catch {
    return null;
  }
}
