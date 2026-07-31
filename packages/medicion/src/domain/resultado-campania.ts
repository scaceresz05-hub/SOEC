/**
 * Resultado de campaña conectado con su evidencia de atribución (Bloque F del Director de
 * Marketing Autónomo V1). Extiende `@soec/medicion` distinguiendo la PROCEDENCIA de cada
 * métrica y calculando el ROI sólo cuando la evidencia lo permite honestamente:
 *
 *   - El ROI sólo es REAL cuando TODOS sus componentes son verificables: gasto real/observado E
 *     ingresos reales/observados, atribución suficiente, ventana definida, misma organización y
 *     campaña, con fuentes trazables. Si CUALQUIER componente es SIMULADO o ESTIMADO, el
 *     resultado se degrada a SIMULADO / ESTIMADO respectivamente (nunca REAL).
 *   - Una campaña ejecutada de forma simulada (Bloque E) NUNCA produce un ROI real.
 *   - Ingresos sin atribución suficiente ⇒ NO_CONCLUYENTE (no se afirma retorno).
 *   - Métricas de otra organización no pueden incorporarse.
 *   - División por cero (gasto 0) ⇒ NO_CONCLUYENTE (no se inventa un infinito); períodos
 *     incompletos ⇒ NO_CONCLUYENTE; ausencia total de datos ⇒ NO_EVALUABLE.
 *
 * Reutiliza el módulo de atribución existente (`atribuir`, `Atribucion`, `ClaseEvidencia`).
 */
import { SoecError } from '@soec/contracts';
import { type Atribucion, type ConversionObservada, atribuir } from './attribution';

/** Se intentó incorporar métricas de otra organización a la medición de una campaña. */
export class MetricaCruzadaError extends SoecError {}

/** De dónde viene el número. Determina qué conclusiones son honestas. */
export type ProcedenciaMetrica =
  | 'OBSERVADA' // medida directamente en la plataforma
  | 'IMPORTADA' // traída de una fuente externa (declarada)
  | 'CALCULADA' // derivada determinísticamente de insumos reales
  | 'ESTIMADA' // modelada/estimada; NO es un hecho observado
  | 'SIMULADA'; // proveniente de una ejecución simulada; NO es un efecto real

const REALES: ReadonlySet<ProcedenciaMetrica> = new Set(['OBSERVADA', 'IMPORTADA', 'CALCULADA']);

/** Una procedencia "real" corresponde a un hecho medible; ESTIMADA y SIMULADA no. */
export function esProcedenciaReal(p: ProcedenciaMetrica): boolean {
  return REALES.has(p);
}
export function esObservada(p: ProcedenciaMetrica): boolean {
  return p === 'OBSERVADA';
}

/**
 * Clasificación honesta del ROI de una campaña. `REAL` exige que TODOS sus componentes sean
 * verificables; si alguno es simulado, estimado o insuficiente, el resultado se degrada.
 */
export type ClasificacionRoi = 'REAL' | 'SIMULADO' | 'ESTIMADO' | 'NO_CONCLUYENTE' | 'NO_EVALUABLE';

/** Ranking de "no-realidad": SIMULADA es lo menos real, luego ESTIMADA, luego lo real. */
const ORDEN_NO_REAL: Record<ProcedenciaMetrica, number> = {
  SIMULADA: 3,
  ESTIMADA: 2,
  OBSERVADA: 1,
  IMPORTADA: 1,
  CALCULADA: 1,
};

/** Devuelve la procedencia MENOS real de las dos (la que contamina el resultado combinado). */
export function peorProcedencia(a: ProcedenciaMetrica, b: ProcedenciaMetrica): ProcedenciaMetrica {
  return ORDEN_NO_REAL[a] >= ORDEN_NO_REAL[b] ? a : b;
}

export interface ValorMedido {
  readonly valor: number;
  readonly procedencia: ProcedenciaMetrica;
}

export interface EntradaResultadoCampania {
  readonly organizacionId: string;
  readonly campaignRef: string;
  readonly ventana: string;
  readonly gasto: ValorMedido;
  readonly ingresos: ValorMedido;
  readonly conversiones: readonly ConversionObservada[];
  /** Cada conversión declara su organización para impedir contaminación cruzada. */
  readonly organizacionPorConversion?: readonly string[];
  readonly periodoCompleto: boolean;
}

export interface ResultadoCampania {
  readonly organizacionId: string;
  readonly campaignRef: string;
  readonly ventana: string;
  readonly ingresos: ValorMedido;
  readonly gasto: ValorMedido;
  readonly atribucion: Atribucion;
  /** Clasificación autoritativa del ROI. Sólo `REAL` si TODOS los componentes son verificables. */
  readonly clasificacion: ClasificacionRoi;
  /** ROI sólo cuando la clasificación es REAL (gasto e ingresos reales + atribución + gasto>0 + período cerrado). */
  readonly roiReal: number | null;
  /** ROI meramente ilustrativo/provisional (no real); informativo, nunca presentado como real. */
  readonly roiEstimado: number | null;
  readonly ingresosObservados: boolean;
  readonly concluyente: boolean;
  readonly motivo: string;
  readonly advertencias: readonly string[];
}

/** División protegida: denominador 0 ⇒ null (no se inventa un infinito ni un 0). */
export function dividirSeguro(numerador: number, denominador: number): number | null {
  if (!(denominador > 0)) return null;
  return numerador / denominador;
}

/**
 * Evalúa el resultado de una campaña a partir de su evidencia. Nunca afirma un retorno que la
 * evidencia no sostiene. Lanza `MetricaCruzadaError` si se intenta incorporar datos de otra org.
 */
export function evaluarResultadoCampania(e: EntradaResultadoCampania): ResultadoCampania {
  // Separación: ninguna conversión puede pertenecer a otra organización.
  if (e.organizacionPorConversion) {
    const ajena = e.organizacionPorConversion.find((o) => o !== e.organizacionId);
    if (ajena !== undefined) {
      throw new MetricaCruzadaError(`no se pueden incorporar métricas de la organización '${ajena}' a '${e.organizacionId}'`);
    }
  }

  const atribucion = atribuir(e.campaignRef, e.conversiones, e.ventana);
  const atribucionSuficiente = atribucion.clase === 'atribucion' && atribucion.conversiones > 0;
  const roiBruto = dividirSeguro(e.ingresos.valor - e.gasto.valor, e.gasto.valor);
  const advertencias: string[] = [];

  // El ROI hereda la procedencia MENOS real de sus dos componentes: gasto E ingresos. Un solo
  // componente simulado o estimado impide clasificarlo como REAL.
  const procedenciaCombinada = peorProcedencia(e.gasto.procedencia, e.ingresos.procedencia);

  let clasificacion: ClasificacionRoi;
  let motivo: string;

  if (procedenciaCombinada === 'SIMULADA') {
    clasificacion = 'SIMULADO';
    motivo = 'algún componente (gasto y/o ingresos) es SIMULADO: no puede producir un ROI real';
    advertencias.push('una campaña ejecutada de forma simulada no genera ingresos ni gasto reales; el ROI es ilustrativo');
  } else if (procedenciaCombinada === 'ESTIMADA') {
    clasificacion = 'ESTIMADO';
    motivo = 'algún componente es ESTIMADO: no equivale a un dato observado';
    advertencias.push('el ROI depende de una estimación; no debe leerse como dato observado');
  } else if (e.ingresos.valor === 0 && e.gasto.valor === 0 && e.conversiones.length === 0) {
    clasificacion = 'NO_EVALUABLE';
    motivo = 'sin gasto, sin ingresos y sin conversiones: no hay nada que evaluar';
    advertencias.push('la ausencia de datos no es un resultado; no se puede concluir un ROI');
  } else if (roiBruto === null) {
    clasificacion = 'NO_CONCLUYENTE';
    motivo = 'gasto cero o inválido: ROI indefinido';
    advertencias.push('no se puede dividir por un gasto de 0; no se inventa un infinito ni un 0');
  } else if (!atribucionSuficiente) {
    clasificacion = 'NO_CONCLUYENTE';
    motivo = 'ingresos sin atribución suficiente: resultado no concluyente';
    advertencias.push(atribucion.evidencia);
  } else if (!e.periodoCompleto) {
    clasificacion = 'NO_CONCLUYENTE';
    motivo = 'período incompleto: ROI provisional, no concluyente';
    advertencias.push('el período de medición aún no cierra; el valor puede cambiar');
  } else {
    clasificacion = 'REAL';
    motivo = 'gasto e ingresos observados, atribución suficiente, gasto válido y período cerrado';
  }

  const roiReal = clasificacion === 'REAL' ? roiBruto : null;
  // ROI ilustrativo cuando se puede calcular pero NO es real (nunca en div/0 ni sin datos).
  const roiEstimado = clasificacion === 'REAL' || clasificacion === 'NO_EVALUABLE' ? null : roiBruto;

  return {
    organizacionId: e.organizacionId,
    campaignRef: e.campaignRef,
    ventana: e.ventana,
    ingresos: e.ingresos,
    gasto: e.gasto,
    atribucion,
    clasificacion,
    roiReal,
    roiEstimado,
    ingresosObservados: esObservada(e.ingresos.procedencia) && esObservada(e.gasto.procedencia),
    concluyente: clasificacion === 'REAL',
    motivo,
    advertencias,
  };
}
