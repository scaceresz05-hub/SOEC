/**
 * @soec/motor-medicion · aplicación · RECONCILIADOR DE MEDICIÓN (recuperación transversal M8).
 *
 * Recorre observaciones, evaluaciones, vínculos de aprendizaje y ejecuciones de M7; detecta la matriz de
 * inconsistencias del Bloque Maestro y REPARA idempotentemente o CLASIFICA honestamente. No borra ni altera
 * historia. Determinista. Dos reconciliadores concurrentes convergen (concurrencia optimista). Tras replay
 * frío, un nuevo reconciliador no encuentra nada nuevo que reparar.
 *
 * Clasificaciones: REPARADA · NO_REQUIERE_ACCION · NO_REPARABLE · REQUIERE_INTERVENCION.
 */
import { ConcurrencyError, type Attribution, type RequestContext } from '@soec/contracts';
import { type LecturaOperativa, clasificarM8 } from '@soec/motor-operacion';
import { ObservacionService } from './observacion-service';
import { EvaluacionService } from './evaluacion-service';
import { AprendizajeOperacionalService } from './aprendizaje-op-service';

export type ClaseHallazgoMedicion =
  | 'EJECUCION_SIN_OBSERVACION'
  | 'OBSERVACION_SIN_EJECUCION_VALIDA'
  | 'KPI_INCONSISTENTE'
  | 'UNIDAD_INCOMPATIBLE'
  | 'RESULTADO_SIN_EVIDENCIA'
  | 'APRENDIZAJE_SIN_EVALUACION'
  | 'EVALUACION_DUPLICADA'
  | 'CONSUMO_SIN_RESULTADO'
  | 'OBSERVACION_SIMULADA_MARCADA_REAL'
  | 'APRENDIZAJE_CON_EVALUACION_OBSOLETA'
  | 'READ_MODEL_INCOMPLETO'
  | 'EVALUACION_SIN_EXPLICACION';

export type Clasificacion = 'REPARADA' | 'NO_REQUIERE_ACCION' | 'NO_REPARABLE' | 'REQUIERE_INTERVENCION';

export interface HallazgoMedicion {
  readonly clase: ClaseHallazgoMedicion;
  readonly clasificacion: Clasificacion;
  readonly ref?: string;
  readonly detalle: string;
}

export class ReconciliadorMedicionService {
  constructor(
    private readonly observaciones: ObservacionService,
    private readonly evaluaciones: EvaluacionService,
    private readonly aprendizajesOp: AprendizajeOperacionalService,
    private readonly lecturaM7: LecturaOperativa,
  ) {}

  private async intentar(fn: () => Promise<unknown>): Promise<Clasificacion> {
    try { await fn(); return 'REPARADA'; }
    catch (e) { return e instanceof ConcurrencyError ? 'NO_REQUIERE_ACCION' : 'NO_REPARABLE'; }
  }

  async reconciliar(ctx: RequestContext, a: Attribution, o: string): Promise<readonly HallazgoMedicion[]> {
    const h: HallazgoMedicion[] = [];
    const push = (x: HallazgoMedicion) => h.push(x);

    const obsIds = await this.observaciones.listarIds(ctx);
    const observadas = new Map<string, string>(); // ordenId → observacionId (para ejecución-sin-observación)
    const porKpiUnidad = new Map<string, string>(); // kpiId → unidad (para incompatibilidad de unidad)

    for (const id of obsIds) {
      const st = await this.observaciones.cargar(ctx, id);
      if (!st.existe || !st.datos) continue;
      const d = st.datos;
      observadas.set(d.ordenId, id);

      // (1) Observación SIMULADA marcada REAL (corrupción) ⇒ invalidar.
      if ((d.naturaleza as string) === 'REAL' && st.estado !== 'INVALIDA') {
        const cls = await this.intentar(() => this.observaciones.invalidar(ctx, id, 'reconciliación: naturaleza REAL no admitida', a, o));
        push({ clase: 'OBSERVACION_SIMULADA_MARCADA_REAL', clasificacion: cls, ref: id, detalle: 'observación marcada REAL → invalidar' });
      }

      // (2) Observación VALIDADA cuya ejecución ya no es COMPLETA/medible ⇒ invalidar.
      if (st.estado === 'VALIDADA') {
        const orden = await this.lecturaM7.cargarOrden(ctx, d.ordenId);
        const completa = orden.existe && clasificarM8(orden.estado, orden.evidenciaRefs.length > 0) === 'COMPLETA';
        if (!completa) {
          // Una observación YA VALIDADA cuya ejecución dejó de ser válida se DESCARTA (la FSM no admite
          // VALIDADA→INVALIDA; INVALIDA es solo para el fallo de validación inicial).
          const cls = await this.intentar(() => this.observaciones.descartar(ctx, id, 'reconciliación: ejecución no válida/completa', a, o));
          push({ clase: 'OBSERVACION_SIN_EJECUCION_VALIDA', clasificacion: cls, ref: id, detalle: 'observación sin ejecución válida → descartar' });
        }
        // (3) Incompatibilidad de unidad: dos observaciones del mismo KPI con distinta unidad.
        const prev = porKpiUnidad.get(d.kpiId);
        if (prev && prev !== d.unidad) push({ clase: 'UNIDAD_INCOMPATIBLE', clasificacion: 'REQUIERE_INTERVENCION', ref: id, detalle: `KPI ${d.kpiId} con unidades incompatibles (${prev} vs ${d.unidad})` });
        else porKpiUnidad.set(d.kpiId, d.unidad);
      }
    }

    // (4) Ejecución COMPLETA de M7 sin observación asociada ⇒ requiere intervención (M8 no fabrica el hecho).
    //     Si además CONSUMIÓ presupuesto (presupuestoReservado>0) se marca CONSUMO_SIN_RESULTADO.
    for (const orden of await this.lecturaM7.listarOrdenes(ctx, 'EJECUTADA_SIMULADA')) {
      if (orden.clasificacion === 'COMPLETA' && !observadas.has(orden.ordenId)) {
        push({ clase: 'EJECUCION_SIN_OBSERVACION', clasificacion: 'REQUIERE_INTERVENCION', ref: orden.ordenId, detalle: 'ejecución completa sin observación' });
        if ((orden.presupuestoReservado ?? 0) > 0) push({ clase: 'CONSUMO_SIN_RESULTADO', clasificacion: 'REQUIERE_INTERVENCION', ref: orden.ordenId, detalle: 'ejecución con consumo pero sin resultado registrado' });
      }
    }

    // (5) Evaluaciones: duplicadas por observación, sin explicación, KPI incoherente, sin evidencia,
    //     y READ_MODEL_INCOMPLETO (observación referenciada ausente del índice).
    const porObservacion = new Map<string, number>();
    for (const id of await this.evaluaciones.listarIds(ctx)) {
      const st = await this.evaluaciones.cargar(ctx, id);
      if (!st.existe) continue;
      const c = st.cuerpo;
      porObservacion.set(c.observacionId, (porObservacion.get(c.observacionId) ?? 0) + 1);
      // Una evaluación CERRADA (EMITIDA/…) sin explicación es incoherente. (Las ABIERTAS aún no cerraron.)
      if (st.estado !== 'ABIERTA' && !c.explicacion?.trim()) push({ clase: 'EVALUACION_SIN_EXPLICACION', clasificacion: 'REQUIERE_INTERVENCION', ref: id, detalle: 'evaluación cerrada sin explicación' });

      const obs = await this.observaciones.cargar(ctx, c.observacionId);
      if (obs.existe && obs.datos) {
        if (obs.datos.kpiId !== c.kpiId) push({ clase: 'KPI_INCONSISTENTE', clasificacion: 'REQUIERE_INTERVENCION', ref: id, detalle: 'el KPI de la evaluación no coincide con el de la observación' });
        const resultadoEvaluable = c.resultado !== null && c.resultado.estado !== 'NO_EVALUABLE';
        if (st.estado === 'EMITIDA' && resultadoEvaluable && obs.datos.evidenciaOperacionalRef === null && obs.estado === 'VALIDADA') {
          push({ clase: 'RESULTADO_SIN_EVIDENCIA', clasificacion: 'REQUIERE_INTERVENCION', ref: id, detalle: 'evaluación con resultado pero sin evidencia operacional' });
        }
        if (!(await this.observaciones.estaEnIndice(ctx, c.observacionId))) {
          const cls = await this.intentar(() => this.observaciones.reindexar(ctx, c.observacionId, a, o));
          push({ clase: 'READ_MODEL_INCOMPLETO', clasificacion: cls, ref: c.observacionId, detalle: 'observación referenciada ausente del índice → reindexar' });
        }
      }
    }
    for (const [obsId, n] of porObservacion) if (n > 1) push({ clase: 'EVALUACION_DUPLICADA', clasificacion: 'REQUIERE_INTERVENCION', ref: obsId, detalle: `${n} evaluaciones para la misma observación` });

    // (6) Aprendizajes: sin evaluación existente, o vinculados a una evaluación NO vigente (OBSOLETA/
    //     REQUIERE_REVISION) — el aprendizaje debe revisarse.
    for (const v of await this.aprendizajesOp.listarVinculos(ctx)) {
      const ev = await this.evaluaciones.cargar(ctx, v.evaluacionId);
      if (!ev.existe) push({ clase: 'APRENDIZAJE_SIN_EVALUACION', clasificacion: 'REQUIERE_INTERVENCION', ref: v.aprendizajeId, detalle: 'aprendizaje sin evaluación de respaldo' });
      else if (ev.estado === 'OBSOLETA' || ev.estado === 'REQUIERE_REVISION') push({ clase: 'APRENDIZAJE_CON_EVALUACION_OBSOLETA', clasificacion: 'REQUIERE_INTERVENCION', ref: v.aprendizajeId, detalle: `aprendizaje vigente con evaluación ${ev.estado} → revisar` });
    }

    return h;
  }
}
