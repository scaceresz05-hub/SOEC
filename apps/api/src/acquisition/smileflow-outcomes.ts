/**
 * apps/api · Lectura VIVA de leads/demos (Growth) y gasto (Google Ads) de SmileFlow, desde el SSOT.
 *
 * Reutiliza `ObservacionService` y el contrato de exclusión de TEST/DIAG (`ProvenanciaReal.diagnostico`
 * === true ⇒ excluido), el mismo que alimenta `growthFunnel.comercial` del panel de medición. NO usa
 * heurísticas por nombre. El gasto se lee del snapshot last-wins de Google Ads (sólo lectura). Si el
 * store no tiene observaciones, el conteo es 0 con estado CONNECTED_NO_DATA (nunca «no disponible»
 * inventado ni ceros sin fuente).
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { ultimoSnapshotAds, adsSnapshotStreamId } from '../ingesta/ingesta-google-ads-service';
import { VENTANA_DESCONOCIDA, type Ventana } from './economics';

export interface GrowthOutcomes {
  readonly status: 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA';
  readonly leadCreated: number;
  readonly demoRequested: number;
  /** Eventos lead/demo reconocidos como TEST/DIAG y EXCLUIDOS de los conteos comerciales. */
  readonly excludedTest: number;
}

/** Observación REAL mínima para el conteo (naturaleza + procedencia). */
export interface ObsGrowthLite {
  readonly naturaleza: string;
  readonly provenanciaReal: { readonly eventName: string; readonly diagnostico: boolean } | null | undefined;
}

/**
 * Conteo PURO de leads/demos comerciales excluyendo TEST/DIAG. La exclusión es exactamente
 * `provenanciaReal.diagnostico === true` (contrato SSOT, el mismo de `growthFunnel.comercial`);
 * jamás una heurística por nombre. Testeable sin store.
 */
export function contarGrowth(observaciones: readonly ObsGrowthLite[]): GrowthOutcomes {
  let lead = 0;
  let demo = 0;
  let excluded = 0;
  for (const d of observaciones) {
    if (d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
    const p = d.provenanciaReal;
    const esLeadODemo = p.eventName === 'lead_created' || p.eventName === 'demo_requested';
    if (p.diagnostico) {
      if (esLeadODemo) excluded += 1;
      continue;
    }
    if (p.eventName === 'lead_created') lead += 1;
    else if (p.eventName === 'demo_requested') demo += 1;
  }
  return {
    status: lead + demo > 0 ? 'CONNECTED_WITH_DATA' : 'CONNECTED_NO_DATA',
    leadCreated: lead,
    demoRequested: demo,
    excludedTest: excluded,
  };
}

/** Lee observaciones REAL de Growth y cuenta leads/demos comerciales excluyendo diagnóstico. */
export async function leerGrowthSmileflow(store: EventStore, ctx: RequestContext): Promise<GrowthOutcomes> {
  const obs = new ObservacionService(store, {} as never);
  const ids = await obs.listarIds(ctx);
  const items: ObsGrowthLite[] = [];
  for (const id of ids) {
    const st = await obs.cargar(ctx, id);
    if (st.datos) items.push({ naturaleza: st.datos.naturaleza, provenanciaReal: st.datos.provenanciaReal });
  }
  return contarGrowth(items);
}

export interface SpendSmileflow {
  readonly connected: boolean;
  readonly spend: number | null;
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly ventana: Ventana;
}

/** Lee el gasto real de Google Ads (snapshot last-wins, sólo lectura). `null` si no hay snapshot. */
export async function leerSpendSmileflow(store: EventStore, ctx: RequestContext, org: string): Promise<SpendSmileflow> {
  const snap = ultimoSnapshotAds(await store.readStream(ctx, adsSnapshotStreamId(org)));
  if (snap === null) return { connected: false, spend: null, impressions: null, clicks: null, ventana: VENTANA_DESCONOCIDA };
  return {
    connected: true,
    spend: snap.cost,
    impressions: snap.impressions,
    clicks: snap.clicks,
    ventana: { inicio: null, fin: null, timezone: 'UTC', freshness: snap.at },
  };
}
