/**
 * @soec/motor-operacion · aplicación · FACHADA de lectura para M8 (`LecturaOperativa`).
 *
 * Solo lectura, snapshots inmutables (congelados en runtime): órdenes, plan derivado, evidencias por orden,
 * y trabajos. M8 (medición/optimización) consume resultados; NO puede modificar la ejecución histórica.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import { congelarProfundo } from '@soec/motor-creativo';
import { type EstadoOrden, type OrdenState, ordenStreamId, reconstruirOrden } from '../dominio/orden';
import { type TrabajoState, trabajoStreamId, reconstruirTrabajo } from '../dominio/cola';
import type { EvidenciaOperacional } from '../dominio/evidencia';
import type { PlanEjecucion } from '../dominio/plan';
import type { LecturaOperativa, OrdenM8 } from '../contratos';
import { OperacionService } from './operacion-service';

export class LecturaOperativaService implements LecturaOperativa {
  constructor(
    private readonly store: EventStore,
    private readonly ordenes: OperacionService,
    private readonly maxIntentos = 3,
  ) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargarOrden(ctx: RequestContext, ordenId: string): Promise<OrdenState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, ordenStreamId(org, ordenId)).then((e) => reconstruirOrden(org, ordenId, e));
  }

  async cargarPlan(ctx: RequestContext, ordenId: string): Promise<PlanEjecucion | null> {
    const st = await this.cargarOrden(ctx, ordenId);
    if (!st.existe || !st.datos) return null;
    const d = st.datos;
    return congelarProfundo({
      ordenId, capacidad: d.capacidad, pieza: d.pieza, variante: d.variante, canalLogico: d.canalLogico,
      instantePlanificado: d.instantePlanificado, limiteConcurrencia: 1, maxIntentos: this.maxIntentos,
      resultadoEsperado: 'EJECUTADA_SIMULADA', kpiFuturo: 'tasa_conversion', compensacion: 'REGISTRAR_REVERSO', naturaleza: 'SIMULADO',
    });
  }

  async listarEvidencias(ctx: RequestContext, ordenId: string): Promise<readonly EvidenciaOperacional[]> {
    const org = this.org(ctx);
    const st = await this.cargarOrden(ctx, ordenId);
    const out: EvidenciaOperacional[] = [];
    for (const ref of st.evidenciaRefs) {
      const evs = await this.store.readStream(ctx, `evidencia:${org}:${ref}`);
      const e = evs.find((x) => x.type === 'evidencia.operacional');
      if (e) out.push(e.payload as EvidenciaOperacional);
    }
    return congelarProfundo(out);
  }

  async listarOrdenes(ctx: RequestContext, estado?: EstadoOrden): Promise<readonly OrdenM8[]> {
    const ids = await this.ordenes.listarOrdenesIds(ctx);
    const out: OrdenM8[] = [];
    for (const id of ids) {
      const st = await this.cargarOrden(ctx, id);
      if (!st.existe) continue;
      if (estado && st.estado !== estado) continue;
      out.push({ ordenId: id, estado: st.estado, intentos: st.intentos, presupuestoReservado: st.presupuestoReservado, evidenciaRefs: st.evidenciaRefs });
    }
    return congelarProfundo(out);
  }

  cargarTrabajo(ctx: RequestContext, trabajoId: string): Promise<TrabajoState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, trabajoStreamId(org, trabajoId)).then((e) => reconstruirTrabajo(org, trabajoId, e));
  }
}
