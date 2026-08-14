/**
 * @soec/autonomia · mandato · LEDGER DE EJECUCIÓN (idempotencia PERSISTENTE, no en memoria).
 *
 * La memoria de proceso no basta como garantía: un runtime real puede tener varios workers, reinicios
 * y solapes de scheduler. Este ledger es EVENT-SOURCED y usa CONCURRENCIA OPTIMISTA (append con versión
 * esperada) para garantizar UNA sola ejecución lógica por `actionId`, incluso con dos procesos
 * compitiendo o tras un reinicio. Tenant-scoped (`autonomia-ejecuciones:<org>`).
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';

export const EVENTO_EJECUCION_RESERVADA = 'autonomia.ejecucion.reservada';

export function ejecucionesStreamId(org: string): string {
  return `autonomia-ejecuciones:${org}`;
}

export type ResultadoReserva = 'RESERVED' | 'DUPLICATE';

const ATRIBUCION: Attribution = {
  source: 'autonomia-ledger',
  purpose: 'reserva idempotente de ejecución (una sola por actionId)',
  assumptions: ['concurrencia optimista', 'tenant-scoped'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

export class LedgerEjecucion {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private async idsReservados(ctx: RequestContext): Promise<Set<string>> {
    const eventos = await this.store.readStream(ctx, ejecucionesStreamId(this.org(ctx)));
    const ids = new Set<string>();
    for (const e of eventos) {
      if (e.type === EVENTO_EJECUCION_RESERVADA) ids.add((e.payload as { actionId: string }).actionId);
    }
    return ids;
  }

  /** actionIds ya reservados (para el gate de idempotencia). Sobrevive reinicios: está persistido. */
  async yaEjecutadas(ctx: RequestContext): Promise<readonly string[]> {
    return [...(await this.idsReservados(ctx))];
  }

  /**
   * Reserva la ejecución de `actionId`. Devuelve RESERVED la primera vez y DUPLICATE si ya estaba
   * (o si otro proceso la reservó en la carrera). Nunca produce dos reservas lógicas.
   */
  async reservar(ctx: RequestContext, actionId: string, ahora: string): Promise<ResultadoReserva> {
    const streamId = ejecucionesStreamId(this.org(ctx));
    for (let intento = 0; intento < 3; intento += 1) {
      const eventos = await this.store.readStream(ctx, streamId);
      if (eventos.some((e) => e.type === EVENTO_EJECUCION_RESERVADA && (e.payload as { actionId: string }).actionId === actionId)) {
        return 'DUPLICATE';
      }
      try {
        // Concurrencia optimista por VERSIÓN (no idempotencyKey, que el store trataría como replay
        // silencioso): dos reservas simultáneas chocan y sólo una queda como RESERVED.
        await this.store.append(ctx, streamId, eventos.length, [
          { type: EVENTO_EJECUCION_RESERVADA, payload: { actionId }, attribution: ATRIBUCION, occurredAt: ahora },
        ]);
        return 'RESERVED';
      } catch (e) {
        if (!(e instanceof ConcurrencyError)) throw e;
        // Otro proceso escribió en la carrera: reintentamos la LECTURA (no la mutación externa).
      }
    }
    // Tras varias carreras, releemos: si ya está, es DUPLICATE; si no, fail-closed.
    return (await this.idsReservados(ctx)).has(actionId) ? 'DUPLICATE' : 'DUPLICATE';
  }
}
