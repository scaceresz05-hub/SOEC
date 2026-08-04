/**
 * @soec/motor-operacion · aplicación · RECONCILIADOR exhaustivo (recuperación transversal).
 *
 * Recorre órdenes, trabajos y reservas; detecta inconsistencias y las REPARA idempotentemente o las
 * CLASIFICA. No borra ni altera historia. Determinista (instante inyectado). Dos reconciliadores
 * concurrentes convergen (concurrencia optimista: la reparación perdedora se clasifica como ya-reparada).
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { type OrdenState, ordenStreamId, reconstruirOrden, transicionValida } from '../dominio/orden';
import { trabajoStreamId, reconstruirTrabajo } from '../dominio/cola';
import { trabajoId as trabajoIdDe } from '../dominio/idempotencia';
import { comprometeReserva } from '../dominio/reserva';
import { OperacionService } from './operacion-service';

export type ClaseHallazgo =
  | 'ORDEN_PROGRAMADA_SIN_TRABAJO'
  | 'ORDEN_EN_EJECUCION_SIN_TRABAJO_ACTIVO'
  | 'ORDEN_EJECUTADA_SIN_EVIDENCIA'
  | 'RESERVA_HUERFANA'
  | 'TRABAJO_HUERFANO';

export type Clasificacion = 'REPARADA' | 'NO_REQUIERE_ACCION' | 'NO_REPARABLE' | 'REQUIERE_INTERVENCION';

export interface HallazgoReconciliacion {
  readonly ordenId?: string;
  readonly reservaId?: string;
  readonly clase: ClaseHallazgo;
  readonly clasificacion: Clasificacion;
  readonly detalle: string;
}

export class ReconciliadorService {
  constructor(private readonly store: EventStore, private readonly ordenes: OperacionService) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  private cargarOrden(ctx: RequestContext, ordenId: string): Promise<OrdenState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, ordenStreamId(org, ordenId)).then((e) => reconstruirOrden(org, ordenId, e));
  }

  async reconciliar(ctx: RequestContext, ahora: string, a: Attribution, o: string): Promise<readonly HallazgoReconciliacion[]> {
    const org = this.org(ctx);
    const h: HallazgoReconciliacion[] = [];

    for (const ordenId of await this.ordenes.listarOrdenesIds(ctx)) {
      const st = await this.cargarOrden(ctx, ordenId);
      if (!st.existe) continue;

      if (st.estado === 'PROGRAMADA') {
        const tid = trabajoIdDe(org, ordenId, st.intentos + 1);
        const tw = reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
        if (!tw.existe) {
          const cls = await this.intentar(() => this.ordenes.encolar(ctx, ordenId, a, o));
          h.push({ ordenId, clase: 'ORDEN_PROGRAMADA_SIN_TRABAJO', clasificacion: cls, detalle: 'orden programada sin trabajo → encolar' });
        }
      }

      if (st.estado === 'EN_EJECUCION') {
        const tid = trabajoIdDe(org, ordenId, st.intentos);
        const tw = reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
        // Abandonado: sin trabajo, trabajo fallido, o RECLAMADO con lease VENCIDO (reclamable por vencimiento).
        const abandonado = !tw.existe || tw.estado === 'FALLIDO' || (tw.estado === 'RECLAMADO' && Date.parse(tw.leaseVenceEn ?? ahora) <= Date.parse(ahora));
        if (abandonado && transicionValida('EN_EJECUCION', 'FALLIDA')) {
          const cls = await this.intentar(async () => {
            const fresca = await this.cargarOrden(ctx, ordenId);
            if (fresca.estado === 'EN_EJECUCION') {
              await this.store.append(ctx, ordenStreamId(org, ordenId), fresca.version, [{ type: 'orden.transicionada', payload: { estado: 'FALLIDA', motivo: 'reconciliación: ejecución sin cierre' }, attribution: a, occurredAt: o }]);
            }
          });
          h.push({ ordenId, clase: 'ORDEN_EN_EJECUCION_SIN_TRABAJO_ACTIVO', clasificacion: cls, detalle: 'ejecución sin cierre → FALLIDA' });
        }
      }

      if (st.estado === 'EJECUTADA_SIMULADA' && st.evidenciaRefs.length === 0) {
        h.push({ ordenId, clase: 'ORDEN_EJECUTADA_SIN_EVIDENCIA', clasificacion: 'REQUIERE_INTERVENCION', detalle: 'ejecutada sin evidencia (no reparable automáticamente)' });
      }
    }

    // Reservas huérfanas: RESERVADA cuya orden quedó terminal SIN ejecutarse ⇒ liberar.
    for (const rid of await this.ordenes.listarReservasIds(ctx)) {
      const r = await this.ordenes.cargarReserva(ctx, rid);
      if (!r.existe || !comprometeReserva(r.estado)) continue;
      if (r.estado !== 'RESERVADA') continue;
      const orden = await this.cargarOrden(ctx, r.ordenId);
      // FALLIDA se excluye: puede re-encolarse y reutilizar su reserva (misma ejecución lógica).
      const terminalNoEjecutada = ['CANCELADA', 'EXPIRADA', 'OBSOLETA'].includes(orden.estado);
      if (terminalNoEjecutada) {
        const cls = await this.intentar(() => this.ordenes.liberarReserva(ctx, rid, 'reconciliación: reserva huérfana', a, o));
        h.push({ reservaId: rid, ordenId: r.ordenId, clase: 'RESERVA_HUERFANA', clasificacion: cls, detalle: 'reserva sin ejecución con orden terminal → liberar' });
      }
    }

    return h;
  }

  /** Ejecuta una reparación; si otro reconciliador ya la aplicó (ConcurrencyError), clasifica como no-requiere-acción. */
  private async intentar(fn: () => Promise<unknown>): Promise<Clasificacion> {
    try {
      await fn();
      return 'REPARADA';
    } catch (e) {
      if (e instanceof ConcurrencyError) return 'NO_REQUIERE_ACCION';
      return 'NO_REPARABLE';
    }
  }
}
