/**
 * @soec/motor-operacion · aplicación · RECONCILIADOR (recuperación transversal).
 *
 * Encuentra inconsistencias entre órdenes, trabajos y evidencias y las CLASIFICA. Repara de forma
 * idempotente lo que es reparable (p. ej. una orden EN_EJECUCION cuyo trabajo quedó con lease vencido y sin
 * cierre → se marca FALLIDA para reintento/compensación); clasifica como NO_REPARABLE lo que exige decisión.
 * No borra eventos ni historia. Determinista (instante inyectado). Idempotente: correr dos veces converge.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import { type OrdenState, ordenStreamId, reconstruirOrden, transicionValida } from '../dominio/orden';
import { reclamable, trabajoStreamId, reconstruirTrabajo } from '../dominio/cola';
import { trabajoId as trabajoIdDe } from '../dominio/idempotencia';
import { OperacionService } from './operacion-service';

export type ClaseHallazgo =
  | 'ORDEN_EN_EJECUCION_SIN_TRABAJO_ACTIVO'
  | 'ORDEN_EJECUTADA_SIN_EVIDENCIA'
  | 'TRABAJO_LEASE_VENCIDO';

export interface HallazgoReconciliacion {
  readonly ordenId: string;
  readonly clase: ClaseHallazgo;
  readonly reparado: boolean;
  readonly detalle: string;
}

export class ReconciliadorService {
  constructor(private readonly store: EventStore, private readonly ordenes: OperacionService) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  private cargarOrden(ctx: RequestContext, ordenId: string): Promise<OrdenState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, ordenStreamId(org, ordenId)).then((e) => reconstruirOrden(org, ordenId, e));
  }

  /** Recorre las órdenes y reconcilia. `ahora` inyectado para determinismo. */
  async reconciliar(ctx: RequestContext, ahora: string, a: Attribution, o: string): Promise<readonly HallazgoReconciliacion[]> {
    const org = this.org(ctx);
    const hallazgos: HallazgoReconciliacion[] = [];
    for (const ordenId of await this.ordenes.listarOrdenesIds(ctx)) {
      const st = await this.cargarOrden(ctx, ordenId);
      if (!st.existe) continue;
      if (st.estado === 'EN_EJECUCION') {
        const tid = trabajoIdDe(org, ordenId, st.intentos);
        const tw = reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
        const abandonado = !tw.existe || tw.estado === 'FALLIDO' || (tw.estado === 'RECLAMADO' && !reclamable(tw, ahora) && Date.parse(tw.leaseVenceEn ?? ahora) <= Date.parse(ahora));
        if (abandonado && transicionValida('EN_EJECUCION', 'FALLIDA')) {
          // Reparación idempotente: si sigue EN_EJECUCION, se marca FALLIDA para reintento/compensación.
          await this.store.append(ctx, ordenStreamId(org, ordenId), st.version, [{ type: 'orden.transicionada', payload: { estado: 'FALLIDA', motivo: 'reconciliación: ejecución sin cierre' }, attribution: a, occurredAt: o }]);
          hallazgos.push({ ordenId, clase: 'ORDEN_EN_EJECUCION_SIN_TRABAJO_ACTIVO', reparado: true, detalle: 'ejecución sin cierre → FALLIDA' });
        }
      }
      if (st.estado === 'EJECUTADA_SIMULADA' && st.evidenciaRefs.length === 0) {
        hallazgos.push({ ordenId, clase: 'ORDEN_EJECUTADA_SIN_EVIDENCIA', reparado: false, detalle: 'ejecutada sin evidencia (no reparable automáticamente)' });
      }
    }
    return hallazgos;
  }
}
