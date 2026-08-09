/**
 * apps/api · CAPA DE COMPOSICIÓN · Servicio de INGESTA Google Ads → SOEC (una corrida, READ ONLY).
 *
 * Orquesta: pedir al adaptador real (frontera) las métricas de campaña y los términos de búsqueda (GAQL de
 * sólo lectura), mapearlos a observaciones REALES y registrarlas vía la puerta gobernada de M8
 * (`registrarReal`, idempotente por observacionId), y avanzar un checkpoint event-sourced con la última fecha
 * procesada. NO reimplementa idempotencia: se apoya en la del ObservacionService (por externalEventId). Ningún
 * token se imprime ni se retorna.
 */
import type { AdaptadorExterno } from '@soec/adaptadores';
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { EntradaObservacionReal, ObservacionService } from '@soec/motor-medicion';
import {
  GAQL_CAMPANIAS, GAQL_CAMPANIA_SNAPSHOT, GAQL_TERMINOS, fechaMaxima, mapearCampania, mapearCampaniaSnapshot,
  mapearTerminos, parsearSearchStream,
} from './mapa-google-ads';

export interface DependenciasIngestaGoogleAds {
  readonly adaptador: AdaptadorExterno;
  readonly observaciones: ObservacionService;
  readonly store: EventStore;
  readonly org: string;
  readonly customerId: string;
}

export interface ResumenIngestaAds {
  readonly campaniasFilas: number;
  readonly snapshotFilas: number;
  readonly terminosFilas: number;
  readonly nuevos: number;
  readonly ingeridos: number;
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

  async correrUnaVez(ctx: RequestContext, opts: { ahora: string }): Promise<ResumenIngestaAds> {
    // Snapshot de ids previos para contar nuevos (registrarReal es idempotente igualmente).
    const idsAntes = new Set(await this.deps.observaciones.listarIds(ctx));

    const filasCampania = await this.consultar(ctx, GAQL_CAMPANIAS, 'campanias');
    const obsCampania = mapearCampania(filasCampania);
    let nuevos = await this.registrar(ctx, obsCampania, idsAntes, opts.ahora);

    // Snapshot acumulado de campaña (siempre observable, aunque la campaña aún no sirva → 0 real).
    const fechaSync = opts.ahora.slice(0, 10);
    const filasSnapshot = await this.consultar(ctx, GAQL_CAMPANIA_SNAPSHOT, 'snapshot');
    const obsSnapshot = mapearCampaniaSnapshot(filasSnapshot, fechaSync);
    nuevos += await this.registrar(ctx, obsSnapshot, idsAntes, opts.ahora);

    const filasTerminos = await this.consultar(ctx, GAQL_TERMINOS, 'terminos');
    const obsTerminos = mapearTerminos(filasTerminos);
    nuevos += await this.registrar(ctx, obsTerminos, idsAntes, opts.ahora);

    // Checkpoint event-sourced: última fecha procesada entre ambas consultas.
    const fecha = fechaMaxima([...filasCampania, ...filasTerminos]);
    if (fecha) await this.avanzarCursor(ctx, fecha, opts.ahora);

    return {
      campaniasFilas: filasCampania.length,
      snapshotFilas: filasSnapshot.length,
      terminosFilas: filasTerminos.length,
      nuevos,
      ingeridos: obsCampania.length + obsSnapshot.length + obsTerminos.length,
    };
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
