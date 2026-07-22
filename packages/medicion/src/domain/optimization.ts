/**
 * Optimización autónoma (F2-MET-01 §16, §17, §19). Motor DETERMINISTA que traduce una
 * evaluación + atribución + anomalías en una decisión operativa EXPLICABLE, con
 * precondiciones, evidencia mínima, riesgo, política aplicable y reversibilidad. La
 * decisión PROPONE; su efecto pasa por el motor de autorización. El módulo de medición
 * no se autoautoriza, no publica, no gasta ni aumenta su propia autonomía.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Anomalia } from './anomaly';
import type { Atribucion } from './attribution';
import type { Evaluacion } from './evaluation';

export type TipoOptimizacion =
  | 'mantener'
  | 'esperar_datos'
  | 'pausar_actividad'
  | 'reactivar_actividad'
  | 'reducir_frecuencia'
  | 'aumentar_frecuencia'
  | 'cambiar_horario'
  | 'priorizar_variante'
  | 'retirar_variante'
  | 'crear_variante'
  | 'reasignar_presupuesto'
  | 'detener_campania'
  | 'prolongar_campania'
  | 'solicitar_contenido'
  | 'replanificar';

export type EstadoOptimizacion = 'propuesta' | 'autorizada' | 'denegada' | 'aplicada' | 'evaluada_posterior' | 'cancelada';

export const OPTIMIZACION_VERSION = 'optimizacion@1';

/** Política de optimización — extensión compatible con el plano de F2-AUT-01 (no un motor paralelo). */
export interface PoliticaOptimizacion {
  readonly muestraMinima: number;
  readonly umbralPausaTasaConversion: number; // por debajo → candidata a pausa
  readonly umbralEscalamiento: number; // por encima → candidata a escalar
  readonly variacionMaxPresupuesto: number; // fracción [0,1]
  readonly cooldownDias: number;
  readonly campaniasProtegidas: readonly string[];
  readonly actividadesNoModificables: readonly string[];
  readonly escalamientoRequiereAprobacion: boolean;
}

export interface DecisionContenido {
  readonly tipo: TipoOptimizacion;
  readonly objetivoId: string;
  readonly campaniaId: string;
  readonly actividadId: string;
  readonly canal: string;
  readonly parametro: string;
  readonly valorAnterior: string;
  readonly valorPropuesto: string;
  readonly motivo: string;
  readonly evidencia: string;
  readonly confianza: 'baja' | 'media' | 'alta';
  readonly riesgo: 'bajo' | 'medio' | 'alto';
  readonly reversible: boolean;
  readonly requiereAprobacion: boolean;
}

/** Genera una decisión determinista a partir de la evidencia. Es una PROPUESTA. */
export function generarDecision(
  ev: Evaluacion,
  atr: Atribucion,
  anomalias: readonly Anomalia[],
  policy: PoliticaOptimizacion,
  ctx: { campaniaId: string; actividadId: string; canal: string; tasaConversion: number | null },
): DecisionContenido {
  const base = { objetivoId: ev.objetivoId, campaniaId: ctx.campaniaId, actividadId: ctx.actividadId, canal: ctx.canal };
  const gastoBloqueante = anomalias.some((a) => a.codigo === 'gasto_superior_autorizado' || a.codigo === 'tasa_imposible');

  // Una anomalía de gasto/datos bloquea el escalamiento aunque la muestra sea suficiente.
  if (gastoBloqueante) {
    return { ...base, tipo: 'mantener', parametro: 'ninguno', valorAnterior: '—', valorPropuesto: '—', motivo: 'anomalía de gasto/datos: no se escala hasta reconciliar', evidencia: anomalias.map((a) => a.codigo).join(', '), confianza: 'alta', riesgo: 'alto', reversible: true, requiereAprobacion: true };
  }
  if (!ev.evidenciaSuficiente) {
    return { ...base, tipo: 'esperar_datos', parametro: 'evidencia', valorAnterior: ev.calidad, valorPropuesto: `≥ muestra ${policy.muestraMinima}`, motivo: 'evidencia insuficiente para decidir', evidencia: ev.explicacion, confianza: 'alta', riesgo: 'bajo', reversible: true, requiereAprobacion: false };
  }
  if (policy.actividadesNoModificables.includes(ctx.actividadId) || policy.campaniasProtegidas.includes(ctx.campaniaId)) {
    return { ...base, tipo: 'mantener', parametro: 'ninguno', valorAnterior: '—', valorPropuesto: '—', motivo: 'campaña/actividad protegida por política', evidencia: 'no modificable', confianza: 'alta', riesgo: 'bajo', reversible: true, requiereAprobacion: false };
  }
  if (ev.clasificacion === 'sobre_objetivo') {
    return { ...base, tipo: 'aumentar_frecuencia', parametro: 'frecuencia', valorAnterior: 'actual', valorPropuesto: '+1/periodo', motivo: 'desempeño sobre objetivo con evidencia suficiente', evidencia: ev.explicacion, confianza: atr.confianza === 'alta' ? 'alta' : 'media', riesgo: 'medio', reversible: true, requiereAprobacion: policy.escalamientoRequiereAprobacion };
  }
  if (ev.clasificacion === 'bajo_umbral') {
    const bajoConversion = ctx.tasaConversion !== null && ctx.tasaConversion < policy.umbralPausaTasaConversion;
    return { ...base, tipo: 'pausar_actividad', parametro: 'estado', valorAnterior: 'autorizable', valorPropuesto: 'pausada', motivo: bajoConversion ? 'tasa de conversión por debajo del umbral con evidencia suficiente' : 'desempeño por debajo del umbral', evidencia: ev.explicacion, confianza: 'media', riesgo: 'bajo', reversible: true, requiereAprobacion: false };
  }
  return { ...base, tipo: 'mantener', parametro: 'ninguno', valorAnterior: '—', valorPropuesto: '—', motivo: 'desempeño dentro de rango; no se justifica un cambio', evidencia: ev.explicacion, confianza: 'media', riesgo: 'bajo', reversible: true, requiereAprobacion: false };
}

// ── Agregado de decisión de optimización ────────────────────────────────────
export const EVENTOS_OPT = {
  propuesta: 'opt.propuesta',
  autorizada: 'opt.autorizada',
  denegada: 'opt.denegada',
  aplicada: 'opt.aplicada',
  evaluada: 'opt.evaluada',
} as const;

export function optStreamId(optId: string): string {
  return `opt:${optId}`;
}

export interface OptimizacionState {
  readonly optId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly decision: DecisionContenido | null;
  readonly estado: EstadoOptimizacion;
  readonly motivoDenegacion: string | null;
  readonly planVersionResultante: number | null;
  readonly resultadoPosterior: string | null;
  readonly historial: readonly { estado: EstadoOptimizacion; en: string }[];
}

export function estadoInicialOpt(optId: string, organizationId: string): OptimizacionState {
  return { optId, organizationId, version: 0, existe: false, decision: null, estado: 'propuesta', motivoDenegacion: null, planVersionResultante: null, resultadoPosterior: null, historial: [] };
}

interface PProp {
  decision: DecisionContenido;
}
interface PDen {
  motivo: string;
}
interface PApl {
  planVersion: number;
}
interface PEval {
  resultado: string;
}

export function aplicarOpt(state: OptimizacionState, event: RecordedEvent): OptimizacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_OPT.propuesta: {
      const p = event.payload as PProp;
      return { ...next, existe: true, decision: p.decision, estado: 'propuesta', historial: [{ estado: 'propuesta', en: event.recordedAt }] };
    }
    case EVENTOS_OPT.autorizada:
      return { ...next, estado: 'autorizada', historial: [...state.historial, { estado: 'autorizada', en: event.recordedAt }] };
    case EVENTOS_OPT.denegada: {
      const p = event.payload as PDen;
      return { ...next, estado: 'denegada', motivoDenegacion: p.motivo, historial: [...state.historial, { estado: 'denegada', en: event.recordedAt }] };
    }
    case EVENTOS_OPT.aplicada: {
      const p = event.payload as PApl;
      return { ...next, estado: 'aplicada', planVersionResultante: p.planVersion, historial: [...state.historial, { estado: 'aplicada', en: event.recordedAt }] };
    }
    case EVENTOS_OPT.evaluada: {
      const p = event.payload as PEval;
      return { ...next, estado: 'evaluada_posterior', resultadoPosterior: p.resultado, historial: [...state.historial, { estado: 'evaluada_posterior', en: event.recordedAt }] };
    }
    default:
      return next;
  }
}

export function reconstruirOpt(optId: string, organizationId: string, events: readonly RecordedEvent[]): OptimizacionState {
  return events.reduce(aplicarOpt, estadoInicialOpt(optId, organizationId));
}
