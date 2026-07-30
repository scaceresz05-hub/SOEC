/**
 * Resultado de campaña conectado con su evidencia de atribución (Bloque F del Director de
 * Marketing Autónomo V1). Extiende `@soec/medicion` distinguiendo la PROCEDENCIA de cada
 * métrica y calculando el ROI sólo cuando la evidencia lo permite honestamente:
 *
 *   - Una métrica SIMULADA (ej. ingresos derivados de la ejecución simulada, Bloque E) NO
 *     produce ROI real.
 *   - Una métrica ESTIMADA no se presenta como observada.
 *   - Ingresos sin atribución suficiente ⇒ resultado NO concluyente (no se afirma retorno).
 *   - Métricas de otra organización no pueden incorporarse.
 *   - División por cero (gasto 0) y períodos incompletos se manejan explícitamente.
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
  /** ROI sólo cuando ingresos reales + atribución suficiente + gasto > 0 + período completo. */
  readonly roiReal: number | null;
  /** ROI meramente estimado/provisional (no observado); informativo, nunca presentado como real. */
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

  let roiReal: number | null = null;
  let roiEstimado: number | null = null;
  let concluyente = false;
  let motivo: string;

  if (e.ingresos.procedencia === 'SIMULADA') {
    motivo = 'ingresos simulados: no producen un ROI real';
    roiEstimado = roiBruto;
    advertencias.push('los ingresos provienen de una ejecución simulada; cualquier ROI es ilustrativo, no real');
  } else if (!esProcedenciaReal(e.ingresos.procedencia)) {
    // ESTIMADA: no se presenta como observada.
    motivo = 'ingresos estimados: no equivalen a ingresos observados';
    roiEstimado = roiBruto;
    advertencias.push('los ingresos son una estimación; no deben leerse como dato observado');
  } else if (!atribucionSuficiente) {
    motivo = 'ingresos sin atribución suficiente: resultado no concluyente';
    advertencias.push(atribucion.evidencia);
  } else if (roiBruto === null) {
    motivo = 'gasto cero o inválido: ROI indefinido';
    advertencias.push('no se puede dividir por un gasto de 0');
  } else if (!e.periodoCompleto) {
    motivo = 'período incompleto: ROI provisional, no concluyente';
    roiEstimado = roiBruto;
    advertencias.push('el período de medición aún no cierra; el valor puede cambiar');
  } else {
    roiReal = roiBruto;
    concluyente = true;
    motivo = 'ingresos observados y atribuidos con gasto válido en período cerrado';
  }

  return {
    organizacionId: e.organizacionId,
    campaignRef: e.campaignRef,
    ventana: e.ventana,
    ingresos: e.ingresos,
    gasto: e.gasto,
    atribucion,
    roiReal,
    roiEstimado,
    ingresosObservados: esObservada(e.ingresos.procedencia),
    concluyente,
    motivo,
    advertencias,
  };
}
