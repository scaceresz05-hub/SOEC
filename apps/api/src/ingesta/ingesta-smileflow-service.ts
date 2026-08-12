/**
 * apps/api · CAPA DE COMPOSICIÓN · Servicio de INGESTA SmileFlow Growth → SOEC (una corrida).
 *
 * Orquesta: leer checkpoint de cursor (event-sourced), pedir eventos al adaptador real (frontera), mapearlos
 * y registrarlos como observaciones REALES vía la puerta gobernada de M8 (`registrarReal`, idempotente por
 * observacionId), y avanzar el cursor. NO reimplementa idempotencia: se apoya en la del ObservacionService
 * (por externalEventId) y en el índice de observaciones. El token nunca se imprime ni se retorna.
 */
import type { AdaptadorExterno } from '@soec/adaptadores';
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { ObservacionService } from '@soec/motor-medicion';
import { type EventoGrowth, esDiagnostico, mapearEventoGrowth, observacionIdDe } from './mapa-growth';

export interface DependenciasIngestaSmileFlow {
  readonly adaptador: AdaptadorExterno;
  readonly observaciones: ObservacionService;
  readonly store: EventStore;
  readonly org: string;
}

export interface ResumenIngesta {
  readonly leidos: number;
  readonly ingeridos: number;
  readonly nuevos: number;
  readonly cursorAntes: number;
  readonly cursorDespues: number;
  readonly diagnosticos: number;
}

interface RespuestaGrowth {
  readonly datos: readonly EventoGrowth[];
  readonly next_cursor: number | null;
}

/** Atribución interna de la ingesta real: observación empírica de baja incertidumbre. */
const ATRIB: Attribution = {
  source: 'smileflow-growth',
  purpose: 'ingesta-real',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

const EVENTO_CURSOR = 'cursor.avanzado';

export class IngestaSmileFlowGrowth {
  constructor(private readonly deps: DependenciasIngestaSmileFlow) {}

  private cursorStreamId(): string {
    return `ingesta-cursor:smileflow-growth:${this.deps.org}`;
  }

  /** Lee el último checkpoint de cursor del stream (0 si no hay) junto con la versión actual del stream. */
  private async leerCursor(ctx: RequestContext): Promise<{ cursor: number; version: number }> {
    const events = await this.deps.store.readStream(ctx, this.cursorStreamId());
    let cursor = 0;
    for (const e of events) {
      if (e.type === EVENTO_CURSOR) cursor = (e.payload as { cursor: number }).cursor;
    }
    return { cursor, version: events.length };
  }

  async correrUnaVez(ctx: RequestContext, opts: { ahora: string; limit?: number }): Promise<ResumenIngesta> {
    const limit = opts.limit ?? 100;
    const { cursor: cursorAntes, version } = await this.leerCursor(ctx);

    const salida = await this.deps.adaptador.ejecutar(ctx, {
      solicitudId: `ingesta-growth:${this.deps.org}:${cursorAntes}`,
      capacidadId: 'ingesta-growth',
      peticion: { operacion: 'growth-events', parametros: { cursor: String(cursorAntes), limit: String(limit) } },
    });
    if (salida.estado === 'ERROR' || salida.salida === null) {
      throw new Error(`ingesta smileflow-growth falló: ${salida.error?.clase ?? 'SIN_SALIDA'} — ${salida.error?.mensaje ?? 'sin cuerpo'}`);
    }

    const body = salida.salida.body ?? '';
    const parsed = JSON.parse(body) as RespuestaGrowth;
    const eventos = parsed.datos ?? [];

    // Idempotencia: qué ids ya estaban antes de esta corrida (registrarReal es idempotente igualmente).
    const idsAntes = new Set(await this.deps.observaciones.listarIds(ctx));
    let nuevos = 0;
    let diagnosticos = 0;
    let maxEventId = cursorAntes;

    for (const ev of eventos) {
      const obsId = observacionIdDe(ev);
      const yaExistia = idsAntes.has(obsId);
      await this.deps.observaciones.registrarReal(ctx, obsId, mapearEventoGrowth(ev), ATRIB, opts.ahora);
      if (!yaExistia) nuevos += 1;
      if (esDiagnostico(ev)) diagnosticos += 1;
      if (ev.event_id > maxEventId) maxEventId = ev.event_id;
    }

    const cursorDespues = parsed.next_cursor ?? maxEventId;
    if (cursorDespues > cursorAntes) {
      try {
        await this.deps.store.append(ctx, this.cursorStreamId(), version, [
          { type: EVENTO_CURSOR, payload: { cursor: cursorDespues }, attribution: ATRIB, occurredAt: opts.ahora },
        ]);
      } catch (e) {
        if (!(e instanceof ConcurrencyError)) throw e; // carrera de cursor ⇒ tolerada (otra corrida avanzó)
      }
    }

    return { leidos: eventos.length, ingeridos: eventos.length, nuevos, cursorAntes, cursorDespues, diagnosticos };
  }
}
