/**
 * @soec/motor-operacion · aplicación · RECONCILIADOR exhaustivo (recuperación transversal).
 *
 * Recorre órdenes (índice), trabajos, reservas, compensaciones, consumo e índices; detecta la matriz de
 * inconsistencias del Bloque Maestro y las REPARA idempotentemente o las CLASIFICA honestamente. No borra
 * ni altera historia (append-only). Determinista (instante inyectado). Dos reconciliadores concurrentes
 * convergen: la reparación perdedora observa `ConcurrencyError` y se clasifica NO_REQUIERE_ACCION. Tras un
 * replay frío desde el log serializado, un nuevo reconciliador no encuentra nada que reparar (idempotencia).
 *
 * Clasificaciones: REPARADA · NO_REQUIERE_ACCION · NO_REPARABLE · REQUIERE_INTERVENCION.
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { type OrdenState, esTerminal, ordenStreamId, reconstruirOrden, transicionValida } from '../dominio/orden';
import { type TrabajoState, trabajoStreamId, reconstruirTrabajo } from '../dominio/cola';
import { trabajoId as trabajoIdDe } from '../dominio/idempotencia';
import { comprometeReserva } from '../dominio/reserva';
import type { EvidenciaOperacional } from '../dominio/evidencia';
import { OperacionService } from './operacion-service';

export type ClaseHallazgo =
  | 'ORDEN_PROGRAMADA_SIN_TRABAJO'
  | 'ORDEN_EN_EJECUCION_ABANDONADA'
  | 'ORDEN_EJECUTADA_SIN_EVIDENCIA'
  | 'ORDEN_VIGENCIA_PERDIDA'
  | 'EFECTO_SIN_CONSUMO'
  | 'CONSUMO_FALTANTE'
  | 'CONSUMO_INCOHERENTE'
  | 'TRABAJO_EN_ORDEN_TERMINAL'
  | 'TRABAJO_HUERFANO'
  | 'RESERVA_HUERFANA'
  | 'COMPENSACION_INCOMPLETA'
  | 'INDICE_INCOMPLETO'
  | 'EVIDENCIA_INCOHERENTE';

export type Clasificacion = 'REPARADA' | 'NO_REQUIERE_ACCION' | 'NO_REPARABLE' | 'REQUIERE_INTERVENCION';

export interface HallazgoReconciliacion {
  readonly ordenId?: string;
  readonly reservaId?: string;
  readonly trabajoId?: string;
  readonly clase: ClaseHallazgo;
  readonly clasificacion: Clasificacion;
  readonly detalle: string;
}

/** Estados de orden pre-efecto en los que aún puede perderse la vigencia M6 sin efecto aplicado. */
const PRE_EFECTO_ACTIVO = ['VALIDADA', 'PROGRAMADA', 'EN_COLA'] as const;

export class ReconciliadorService {
  constructor(private readonly store: EventStore, private readonly ordenes: OperacionService) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  private cargarOrden(ctx: RequestContext, ordenId: string): Promise<OrdenState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, ordenStreamId(org, ordenId)).then((e) => reconstruirOrden(org, ordenId, e));
  }

  private async cargarTrabajo(ctx: RequestContext, tid: string): Promise<TrabajoState> {
    const org = this.org(ctx);
    return reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
  }

  async reconciliar(ctx: RequestContext, ahora: string, a: Attribution, o: string): Promise<readonly HallazgoReconciliacion[]> {
    const org = this.org(ctx);
    const h: HallazgoReconciliacion[] = [];
    const push = (x: HallazgoReconciliacion) => h.push(x);

    for (const ordenId of await this.ordenes.listarOrdenesIds(ctx)) {
      const st = await this.cargarOrden(ctx, ordenId);

      // (A) Orden indexada pero SIN stream (corrupción del read-model): sus trabajos quedan huérfanos.
      if (!st.existe) {
        for (let i = 1; i <= 3; i++) {
          const tid = trabajoIdDe(org, ordenId, i);
          const tw = await this.cargarTrabajo(ctx, tid);
          if (tw.existe && (tw.estado === 'DISPONIBLE' || tw.estado === 'RECLAMADO')) {
            const cls = await this.intentar(() => this.ordenes.fallarTrabajoReconciliacion(ctx, tid, 'reconciliación: trabajo sin orden', a, o));
            push({ ordenId, trabajoId: tid, clase: 'TRABAJO_HUERFANO', clasificacion: cls, detalle: 'trabajo sin orden (índice apunta a orden inexistente) → fallar' });
          }
        }
        continue;
      }
      const d = st.datos!;

      // (B) PROGRAMADA sin trabajo → encolar.
      if (st.estado === 'PROGRAMADA') {
        const tid = trabajoIdDe(org, ordenId, st.intentos + 1);
        if (!(await this.cargarTrabajo(ctx, tid)).existe) {
          const cls = await this.intentar(() => this.ordenes.encolar(ctx, ordenId, a, o));
          push({ ordenId, clase: 'ORDEN_PROGRAMADA_SIN_TRABAJO', clasificacion: cls, detalle: 'programada sin trabajo → encolar' });
        }
      }

      // (C) EN_EJECUCION sin cierre. Si el efecto LÓGICO YA se aplicó ⇒ completar FORWARD hacia EJECUTADA
      //     (confirma consumo, no re-aplica; NUNCA marcar FALLIDA, se perdería el efecto). Si NO se aplicó y
      //     el trabajo está abandonado (lease vencido/ausente/fallido) ⇒ FALLIDA (recuperable por reintento).
      if (st.estado === 'EN_EJECUCION') {
        if (await this.ordenes.efectoAplicadoDe(ctx, ordenId)) {
          const cls = await this.intentar(() => this.ordenes.completarEjecucionReconciliada(ctx, ordenId, a, o));
          push({ ordenId, clase: 'EFECTO_SIN_CONSUMO', clasificacion: cls, detalle: 'ejecución con efecto aplicado sin cierre → completar (confirmar consumo, cerrar)' });
        } else {
          // Busca el ÚLTIMO trabajo existente (robusto ante contador desincronizado): si no hay ninguno
          // activo (RECLAMADO con lease vigente), la ejecución está abandonada.
          let tw: TrabajoState | undefined;
          for (let i = st.intentos + 2; i >= 1; i--) { const cand = await this.cargarTrabajo(ctx, trabajoIdDe(org, ordenId, i)); if (cand.existe) { tw = cand; break; } }
          const abandonado = !tw || tw.estado === 'FALLIDO' || (tw.estado === 'RECLAMADO' && Date.parse(tw.leaseVenceEn ?? ahora) <= Date.parse(ahora));
          if (abandonado) {
            const cls = await this.intentar(async () => {
              const fresca = await this.cargarOrden(ctx, ordenId);
              if (fresca.estado === 'EN_EJECUCION') {
                await this.store.append(ctx, ordenStreamId(org, ordenId), fresca.version, [{ type: 'orden.transicionada', payload: { estado: 'FALLIDA', motivo: 'reconciliación: ejecución sin cierre' }, attribution: a, occurredAt: o }]);
              }
            });
            push({ ordenId, clase: 'ORDEN_EN_EJECUCION_ABANDONADA', clasificacion: cls, detalle: 'ejecución sin efecto ni cierre (lease vencido/sin trabajo) → FALLIDA' });
          }
        }
      }

      // (D) Vigencia M6 perdida en órdenes pre-efecto activas (M6 obsoleto / calendario cancelado /
      //     aprobación revocada) → OBSOLETA. Solo si el efecto NO se aplicó todavía.
      if ((PRE_EFECTO_ACTIVO as readonly string[]).includes(st.estado) && !(await this.ordenes.efectoAplicadoDe(ctx, ordenId))) {
        const v = await this.ordenes.evaluarVigenciaOrden(ctx, ordenId);
        if (!v.ok && transicionValida(st.estado, 'OBSOLETA')) {
          const cls = await this.intentar(async () => {
            const fresca = await this.cargarOrden(ctx, ordenId);
            if (transicionValida(fresca.estado, 'OBSOLETA')) {
              await this.store.append(ctx, ordenStreamId(org, ordenId), fresca.version, [{ type: 'orden.transicionada', payload: { estado: 'OBSOLETA', motivo: `reconciliación: ${v.motivo}` }, attribution: a, occurredAt: o }]);
            }
          });
          push({ ordenId, clase: 'ORDEN_VIGENCIA_PERDIDA', clasificacion: cls, detalle: `vigencia M6 perdida (${v.motivo}) → OBSOLETA` });
        }
      }

      // (E) EJECUTADA sin evidencia (no reparable automáticamente: no se puede fabricar la traza).
      if (st.estado === 'EJECUTADA_SIMULADA' && st.evidenciaRefs.length === 0) {
        push({ ordenId, clase: 'ORDEN_EJECUTADA_SIN_EVIDENCIA', clasificacion: 'REQUIERE_INTERVENCION', detalle: 'ejecutada sin evidencia' });
      }

      // (F) Efecto aplicado + orden EJECUTADA pero reserva sin confirmar (ejecución sin consumo) → confirmar.
      if (st.estado === 'EJECUTADA_SIMULADA' && (await this.ordenes.efectoAplicadoDe(ctx, ordenId))) {
        const { rid } = this.ordenes.clavesDe(ctx, ordenId, d);
        const r = await this.ordenes.cargarReserva(ctx, rid);
        if (r.existe && r.estado === 'RESERVADA') {
          const cls = await this.intentar(() => this.ordenes.confirmarReserva(ctx, rid, r.unidades, a, o));
          push({ ordenId, reservaId: rid, clase: 'EFECTO_SIN_CONSUMO', clasificacion: cls, detalle: 'efecto aplicado con reserva sin confirmar → confirmar consumo' });
        }
      }

      // (G) Trabajo ACTIVO colgando de una orden TERMINAL (cancelada/expirada/obsoleta/compensada/ejecutada)
      //     — resultado tardío tras cancelación, orden expirada con trabajo futuro, etc. → fallar el trabajo.
      if (esTerminal(st.estado)) {
        for (let i = 1; i <= st.intentos + 1; i++) {
          const tid = trabajoIdDe(org, ordenId, i);
          const tw = await this.cargarTrabajo(ctx, tid);
          if (tw.existe && (tw.estado === 'DISPONIBLE' || tw.estado === 'RECLAMADO')) {
            const cls = await this.intentar(() => this.ordenes.fallarTrabajoReconciliacion(ctx, tid, `reconciliación: trabajo activo en orden ${st.estado}`, a, o));
            push({ ordenId, trabajoId: tid, clase: 'TRABAJO_EN_ORDEN_TERMINAL', clasificacion: cls, detalle: `trabajo activo con orden ${st.estado} → fallar` });
          }
        }
      }

      // (H) Compensación incompleta (PENDIENTE / EN_EJECUCION que no llegó a término) → re-conducir.
      const { cid } = this.ordenes.clavesDe(ctx, ordenId, d);
      const comp = await this.ordenes.cargarCompensacion(ctx, cid);
      if (comp.existe && (comp.estado === 'PENDIENTE' || comp.estado === 'EN_EJECUCION')) {
        const cls = await this.intentar(() => this.ordenes.compensar(ctx, ordenId, 'reconciliación: completar compensación', a, o));
        push({ ordenId, clase: 'COMPENSACION_INCOMPLETA', clasificacion: cls, detalle: `compensación ${comp.estado} → re-conducir a término` });
      }

      // (I) Evidencia incoherente: cualquier evidencia con naturaleza ≠ SIMULADO es una violación de seguridad.
      for (const ref of st.evidenciaRefs) {
        const evs = await this.store.readStream(ctx, `evidencia:${org}:${ref}`);
        const e = evs.find((x) => x.type === 'evidencia.operacional');
        const nat = e ? (e.payload as EvidenciaOperacional).naturaleza : 'SIMULADO';
        if (nat !== 'SIMULADO') {
          push({ ordenId, clase: 'EVIDENCIA_INCOHERENTE', clasificacion: 'REQUIERE_INTERVENCION', detalle: `evidencia ${ref} con naturaleza ${nat} (nunca debe existir)` });
        }
      }
    }

    // (J) Reservas: huérfanas (RESERVADA con orden terminal no ejecutada → liberar) e índice de órdenes
    //     incompleto (una reserva referencia una orden que existe pero no está en el índice → reindexar).
    for (const rid of await this.ordenes.listarReservasIds(ctx)) {
      const r = await this.ordenes.cargarReserva(ctx, rid);
      if (!r.existe) continue;
      const orden = await this.cargarOrden(ctx, r.ordenId);
      if (orden.existe && !(await this.ordenes.estaEnIndice(ctx, r.ordenId))) {
        const cls = await this.intentar(() => this.ordenes.reindexarOrden(ctx, r.ordenId, a, o));
        push({ ordenId: r.ordenId, reservaId: rid, clase: 'INDICE_INCOMPLETO', clasificacion: cls, detalle: 'orden con reserva ausente del índice → reindexar' });
      }
      if (comprometeReserva(r.estado) && r.estado === 'RESERVADA') {
        // FALLIDA se excluye: puede re-encolarse y reutilizar su reserva (misma ejecución lógica).
        const terminalNoEjecutada = ['CANCELADA', 'EXPIRADA', 'OBSOLETA'].includes(orden.estado);
        if (terminalNoEjecutada) {
          const cls = await this.intentar(() => this.ordenes.liberarReserva(ctx, rid, 'reconciliación: reserva huérfana', a, o));
          push({ reservaId: rid, ordenId: r.ordenId, clase: 'RESERVA_HUERFANA', clasificacion: cls, detalle: 'reserva sin ejecución con orden terminal → liberar' });
        }
      }
    }

    // (K) Consumo: (K1) reserva CONFIRMADA sin entrada de consumo → registrar (idempotente por rid);
    //     (K2) consumo total mayor que la suma confirmada → incoherencia no reparable.
    let confirmado = 0;
    for (const rid of await this.ordenes.listarReservasIds(ctx)) {
      const r = await this.ordenes.cargarReserva(ctx, rid);
      if (r.existe && r.estado === 'CONFIRMADA') {
        confirmado += r.unidades;
        if (!(await this.ordenes.consumoRegistrado(ctx, rid))) {
          const cls = await this.intentar(() => this.ordenes.asegurarConsumo(ctx, rid, r.unidades, a, o));
          push({ reservaId: rid, ordenId: r.ordenId, clase: 'CONSUMO_FALTANTE', clasificacion: cls, detalle: 'reserva confirmada sin consumo registrado → registrar' });
        }
      }
    }
    if ((await this.ordenes.consumoTotal(ctx)) > confirmado) {
      push({ clase: 'CONSUMO_INCOHERENTE', clasificacion: 'REQUIERE_INTERVENCION', detalle: 'consumo registrado excede las reservas confirmadas' });
    }

    return h;
  }

  /** Ejecuta una reparación; si otro reconciliador ya la aplicó (ConcurrencyError), NO_REQUIERE_ACCION. */
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
