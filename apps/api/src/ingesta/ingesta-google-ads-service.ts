/**
 * apps/api · CAPA DE COMPOSICIÓN · Servicio de INGESTA Google Ads → SOEC (una corrida, READ ONLY).
 *
 * Orquesta tres consultas GAQL de sólo lectura, INDEPENDIENTES entre sí (aislamiento de fallos):
 *  - SNAPSHOT acumulado (all-time) → stream dedicado LAST-WINS `ingesta-ads-snapshot` (el panel lee el más
 *    reciente ⇒ refleja el acumulado de hoy en cada sync; no se congela como una observación first-wins).
 *  - CAMPAÑA por día (ventana que incluye hoy) → observaciones REAL (traza granular por día, exacta al cerrar).
 *  - TÉRMINOS de búsqueda (ventana que incluye hoy) → observaciones REAL.
 *
 * Si una consulta falla, las demás SÍ persisten (resiliencia): el resultado reporta `estado` OK/PARCIAL/FALLO y
 * la lista de `fallos`. NO reimplementa idempotencia (se apoya en `registrarReal`, first-wins por observacionId).
 * Ningún token se imprime ni se retorna.
 */
import type { AdaptadorExterno } from '@soec/adaptadores';
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { EntradaObservacionReal, ObservacionService } from '@soec/motor-medicion';
import {
  GAQL_CAMPANIA_SNAPSHOT, type SnapshotAdsActual, extraerSnapshotActual, fechaMaxima, gaqlCampanias, gaqlTerminos,
  mapearCampania, mapearTerminos, parsearSearchStream, ventanaIngesta,
} from './mapa-google-ads';

export interface DependenciasIngestaGoogleAds {
  readonly adaptador: AdaptadorExterno;
  readonly observaciones: ObservacionService;
  readonly store: EventStore;
  readonly org: string;
  readonly customerId: string;
}

/** Resultado de la corrida: OK (3/3), PARCIAL (1-2/3) o FALLO (0/3 consultas exitosas). */
export type EstadoIngesta = 'OK' | 'PARCIAL' | 'FALLO';

export interface ResumenIngestaAds {
  readonly estado: EstadoIngesta;
  readonly ventana: { desde: string; hasta: string };
  readonly campaniasFilas: number;
  readonly snapshotFilas: number;
  readonly terminosFilas: number;
  readonly nuevos: number;
  readonly ingeridos: number;
  readonly fallos: readonly string[]; // 'etiqueta: mensaje' por cada consulta fallida (sin secretos)
  readonly dataThrough: string | null; // ÚLTIMA fecha (segments.date) realmente devuelta por Google; null si sin filas
}

/** Atribución interna de la ingesta real: observación empírica de baja incertidumbre. */
const ATRIB: Attribution = {
  source: 'google-ads',
  purpose: 'ingesta-real',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

const EVENTO_CURSOR = 'cursor.avanzado';

/** Stream dedicado (LAST-WINS) del snapshot acumulado vigente de Google Ads. El panel lee el evento más reciente. */
export const EVENTO_ADS_SNAPSHOT = 'ads.snapshot';
export function adsSnapshotStreamId(org: string): string {
  return `ingesta-ads-snapshot:google-ads:${org}`;
}
/** Reduce un stream de `ads.snapshot` a su último snapshot (o null si vacío). Puro, para reuso en el panel. */
export function ultimoSnapshotAds(events: readonly { type: string; payload: unknown }[]): SnapshotAdsActual | null {
  let ultimo: SnapshotAdsActual | null = null;
  for (const e of events) if (e.type === EVENTO_ADS_SNAPSHOT) ultimo = e.payload as SnapshotAdsActual;
  return ultimo;
}

/**
 * Estado del ÚLTIMO intento de refresh a Google Ads (observabilidad, LAST-WINS). Hace visible que el botón
 * consultó realmente al proveedor y si la consulta tuvo éxito o falló (p.ej. OAuth caducado). NUNCA secretos.
 */
export const EVENTO_REFRESH_STATE = 'ads.refresh-state';
export function adsRefreshStateStreamId(org: string): string {
  return `ingesta-refresh-state:google-ads:${org}`;
}
export interface AdsRefreshState {
  readonly queriedAt: string; // instante en que SOEC contactó a Google Ads (fetch time real)
  readonly ok: boolean; // ¿la consulta trajo datos y persistió sin fallos?
  readonly estado: string; // GLOBAL_OK | PARTIAL | FALLO (del ResumenIngestaAds)
  readonly ventana: { desde: string; hasta: string };
  readonly error: string | null; // clase/mensaje del fallo (sin secretos), null si ok
  readonly dataThrough: string | null; // última fecha con cobertura real cuando es derivable (ventana.hasta si ok)
}
export function ultimoRefreshState(events: readonly { type: string; payload: unknown }[]): AdsRefreshState | null {
  let ultimo: AdsRefreshState | null = null;
  for (const e of events) if (e.type === EVENTO_REFRESH_STATE) ultimo = e.payload as AdsRefreshState;
  return ultimo;
}

export class IngestaGoogleAds {
  constructor(private readonly deps: DependenciasIngestaGoogleAds) {}

  private cursorStreamId(): string {
    return `ingesta-cursor:google-ads:${this.deps.org}`;
  }

  /** Ejecuta una consulta GAQL vía el adaptador y devuelve las filas parseadas. Lanza si el adaptador falla. */
  private async consultar(ctx: RequestContext, query: string, etiqueta: string): Promise<ReturnType<typeof parsearSearchStream>> {
    const salida = await this.deps.adaptador.ejecutar(ctx, {
      solicitudId: `ingesta-ads:${this.deps.org}:${etiqueta}`,
      capacidadId: 'ingesta-ads',
      peticion: { operacion: 'ingesta-ads', parametros: { query, customerId: this.deps.customerId } },
    });
    if (salida.estado === 'ERROR' || salida.salida === null) {
      throw new Error(`ingesta google-ads (${etiqueta}) falló: ${salida.error?.clase ?? 'SIN_SALIDA'} — ${salida.error?.mensaje ?? 'sin cuerpo'}`);
    }
    return parsearSearchStream(salida.salida.body ?? '');
  }

  private async registrar(ctx: RequestContext, entradas: readonly EntradaObservacionReal[], idsAntes: ReadonlySet<string>, ahora: string): Promise<number> {
    let nuevos = 0;
    for (const e of entradas) {
      // observacionId = externalEventId (ya único y namespaced por proveedor/entidad/día/métrica).
      const obsId = e.externalEventId;
      const yaExistia = idsAntes.has(obsId);
      await this.deps.observaciones.registrarReal(ctx, obsId, e, ATRIB, ahora);
      if (!yaExistia) nuevos += 1;
    }
    return nuevos;
  }

  /** Persiste el snapshot acumulado vigente en el stream dedicado (append last-wins; carrera tolerada). */
  private async registrarSnapshotActual(ctx: RequestContext, snap: SnapshotAdsActual, ahora: string): Promise<void> {
    const streamId = adsSnapshotStreamId(this.deps.org);
    const events = await this.deps.store.readStream(ctx, streamId);
    try {
      await this.deps.store.append(ctx, streamId, events.length, [
        { type: EVENTO_ADS_SNAPSHOT, payload: snap, attribution: ATRIB, occurredAt: ahora },
      ]);
    } catch (e) {
      if (!(e instanceof ConcurrencyError)) throw e; // otra corrida escribió su snapshot ⇒ tolerado
    }
  }

  async correrUnaVez(ctx: RequestContext, opts: { ahora: string }): Promise<ResumenIngestaAds> {
    // Snapshot de ids previos para contar nuevos (registrarReal es idempotente igualmente).
    const idsAntes = new Set(await this.deps.observaciones.listarIds(ctx));
    const ventana = ventanaIngesta(opts.ahora);
    const fallos: string[] = [];
    let nuevos = 0;
    let ingeridos = 0;
    let snapshotFilas = 0;
    let campaniasFilas = 0;
    let terminosFilas = 0;
    let filasCampania: ReturnType<typeof parsearSearchStream> = [];
    let filasTerminos: ReturnType<typeof parsearSearchStream> = [];
    const ok = { snapshot: false, campanias: false, terminos: false };

    // 1) SNAPSHOT acumulado (all-time) → stream dedicado LAST-WINS (fresco cada sync, no se congela).
    try {
      const filas = await this.consultar(ctx, GAQL_CAMPANIA_SNAPSHOT, 'snapshot');
      snapshotFilas = filas.length;
      const snap = extraerSnapshotActual(filas, opts.ahora);
      if (snap) await this.registrarSnapshotActual(ctx, snap, opts.ahora);
      ok.snapshot = true;
    } catch (e) {
      fallos.push(`snapshot: ${mensaje(e)}`);
    }

    // 2) CAMPAÑA por día (ventana incluye hoy) → observaciones (traza granular por día).
    try {
      filasCampania = await this.consultar(ctx, gaqlCampanias(ventana.desde, ventana.hasta), 'campanias');
      campaniasFilas = filasCampania.length;
      const obs = mapearCampania(filasCampania);
      ingeridos += obs.length;
      nuevos += await this.registrar(ctx, obs, idsAntes, opts.ahora);
      ok.campanias = true;
    } catch (e) {
      fallos.push(`campanias: ${mensaje(e)}`);
    }

    // 3) TÉRMINOS de búsqueda (ventana incluye hoy) → observaciones.
    try {
      filasTerminos = await this.consultar(ctx, gaqlTerminos(ventana.desde, ventana.hasta), 'terminos');
      terminosFilas = filasTerminos.length;
      const obs = mapearTerminos(filasTerminos);
      ingeridos += obs.length;
      nuevos += await this.registrar(ctx, obs, idsAntes, opts.ahora);
      ok.terminos = true;
    } catch (e) {
      fallos.push(`terminos: ${mensaje(e)}`);
    }

    // Checkpoint event-sourced: última fecha procesada entre las consultas que SÍ trajeron filas.
    const fecha = fechaMaxima([...filasCampania, ...filasTerminos]);
    if (fecha) await this.avanzarCursor(ctx, fecha, opts.ahora);

    const exitos = Number(ok.snapshot) + Number(ok.campanias) + Number(ok.terminos);
    const estado: EstadoIngesta = exitos === 3 ? 'OK' : exitos === 0 ? 'FALLO' : 'PARCIAL';
    return { estado, ventana, campaniasFilas, snapshotFilas, terminosFilas, nuevos, ingeridos, fallos, dataThrough: fecha };
  }

  /** Lee la última fecha del cursor (o null) junto con la versión actual del stream. */
  private async leerCursor(ctx: RequestContext): Promise<{ fecha: string | null; version: number }> {
    const events = await this.deps.store.readStream(ctx, this.cursorStreamId());
    let fecha: string | null = null;
    for (const e of events) {
      if (e.type === EVENTO_CURSOR) fecha = (e.payload as { fecha: string }).fecha;
    }
    return { fecha, version: events.length };
  }

  private async avanzarCursor(ctx: RequestContext, fecha: string, ahora: string): Promise<void> {
    const { fecha: fechaAntes, version } = await this.leerCursor(ctx);
    if (fechaAntes !== null && fecha <= fechaAntes) return; // no retrocede
    try {
      await this.deps.store.append(ctx, this.cursorStreamId(), version, [
        { type: EVENTO_CURSOR, payload: { fecha }, attribution: ATRIB, occurredAt: ahora },
      ]);
    } catch (e) {
      if (!(e instanceof ConcurrencyError)) throw e; // carrera de cursor ⇒ tolerada (otra corrida avanzó)
    }
  }
}

/** Mensaje de error sin secretos (sólo `Error.message`, que el adaptador ya normaliza sin cuerpo del proveedor). */
function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
