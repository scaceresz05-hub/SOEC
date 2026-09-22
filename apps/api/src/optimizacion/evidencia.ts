/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · portero de evidencia (función pura).
 *
 * La pregunta que responde: **¿hay derecho a decidir todavía?**
 *
 * Optimizar con muestras pequeñas es la forma más común de destruir una campaña con aire de rigor: se pausa la
 * palabra que aún no había tenido tiempo, se sube el presupuesto por un pico de dos días, se excluye un término
 * que convertía. Por eso, antes de cualquier decisión, se exige:
 *
 *   · el MÍNIMO DE EVIDENCIA que la empresa declaró en su política (Fase C) — no uno inventado aquí;
 *   · una ventana de observación suficiente y datos frescos;
 *   · que la medición esté sana si la decisión depende de conversiones;
 *   · que no haya pasado tan poco desde el último cambio que aún no se vea su efecto (cooldown).
 *
 * `INSUFFICIENT` no es un fallo: es el resultado correcto la mayoría de los días.
 */
import type { PoliticaCompleta } from '../politica/politica-pg';
import {
  COOLDOWN_HORAS_POR_DEFECTO,
  type MetricasObservadas,
  type SaludMedicion,
  type VentanaObservacion,
  type VeredictoEvidencia,
} from './optimizacion-tipos';

export interface EntradaEvidencia {
  readonly politica: PoliticaCompleta;
  readonly ventana: VentanaObservacion;
  readonly metricas: MetricasObservadas;
  readonly saludMedicion: SaludMedicion;
  /** Hasta cuándo llegan los datos del proveedor. Si es viejo, la decisión sería sobre el pasado. */
  readonly datosHasta: string | null;
  readonly ahora: string;
  /** Horas desde el último cambio aplicado a esta campaña (null ⇒ nunca se tocó). */
  readonly horasDesdeUltimoCambio: number | null;
  readonly cooldownHoras?: number;
}

export interface ResultadoEvidencia {
  readonly veredicto: VeredictoEvidencia;
  readonly motivo: string;
  /** Mínimo exigido por la política de la empresa y su procedencia, para poder auditar la decisión. */
  readonly minimoExigido: { readonly metrica: string; readonly valor: number; readonly procedencia: string } | null;
  readonly observado: number | null;
  /** `true` si se puede decidir con métricas de CONVERSIÓN (no sólo de tráfico). */
  readonly permiteDecisionesDeConversion: boolean;
}

const HORAS_MAX_DATOS_VIEJOS = 48;

/** Mínimo de evidencia declarado por la empresa (Fase C). Sin él, se es conservador, no permisivo. */
export function minimoDeEvidencia(politica: PoliticaCompleta): { metrica: string; valor: number; procedencia: string } | null {
  const regla = politica.reglas.find((r) => r.tipo === 'EVIDENCE_MINIMUM' && r.valor !== null);
  if (regla === undefined || regla.valor === null) return null;
  return { metrica: String(regla.metrica ?? 'IMPRESSIONS'), valor: Number(regla.valor), procedencia: regla.procedencia ?? 'DESCONOCIDA' };
}

function observadoDe(metrica: string, m: MetricasObservadas): number | null {
  switch (metrica.toUpperCase()) {
    case 'CLICKS': return m.clicks;
    case 'CONVERSIONS': return m.conversions;
    case 'SPEND': case 'COST': return m.spend;
    case 'IMPRESSIONS': default: return m.impressions;
  }
}

/**
 * Evalúa si hay derecho a decidir. El orden importa: primero lo que invalida TODO (datos viejos, señales
 * contradictorias), después lo que sólo limita el tipo de decisión (medición degradada).
 */
export function evaluarEvidencia(e: EntradaEvidencia): ResultadoEvidencia {
  const minimo = minimoDeEvidencia(e.politica);
  const cooldown = e.cooldownHoras ?? COOLDOWN_HORAS_POR_DEFECTO;

  // 1. DATOS VIEJOS: decidir sobre una foto de hace días es decidir sobre otra campaña.
  if (e.datosHasta !== null) {
    const horas = (Date.parse(e.ahora) - Date.parse(e.datosHasta)) / 3_600_000;
    if (Number.isFinite(horas) && horas > HORAS_MAX_DATOS_VIEJOS) {
      return {
        veredicto: 'STALE',
        motivo: `los datos de la plataforma llegan sólo hasta hace ${Math.round(horas)} horas`,
        minimoExigido: minimo, observado: null, permiteDecisionesDeConversion: false,
      };
    }
  }

  // 2. SEÑALES CONTRADICTORIAS: hay conversiones registradas pero ni un clic que las explique.
  if (e.metricas.conversions !== null && e.metricas.conversions > 0 && e.metricas.clicks !== null && e.metricas.clicks === 0) {
    return {
      veredicto: 'CONFLICTING',
      motivo: 'la plataforma informa conversiones sin clics: las señales se contradicen y decidir sería adivinar',
      minimoExigido: minimo, observado: null, permiteDecisionesDeConversion: false,
    };
  }

  // 3. COOLDOWN: aún no se ve el efecto del último cambio.
  if (e.horasDesdeUltimoCambio !== null && e.horasDesdeUltimoCambio < cooldown) {
    return {
      veredicto: 'INSUFFICIENT',
      motivo: `se cambió algo hace ${Math.round(e.horasDesdeUltimoCambio)} h y todavía no se puede ver su efecto (espera ${cooldown} h)`,
      minimoExigido: minimo, observado: null, permiteDecisionesDeConversion: false,
    };
  }

  // 4. MÍNIMO DECLARADO POR LA EMPRESA.
  if (minimo === null) {
    return {
      veredicto: 'INSUFFICIENT',
      motivo: 'la empresa no declaró cuántos datos hacen falta antes de concluir: sin ese mínimo no se optimiza',
      minimoExigido: null, observado: null, permiteDecisionesDeConversion: false,
    };
  }
  const observado = observadoDe(minimo.metrica, e.metricas);
  if (observado === null) {
    return {
      veredicto: 'INSUFFICIENT',
      motivo: `no hay datos de ${minimo.metrica.toLowerCase()} en esta ventana`,
      minimoExigido: minimo, observado: null, permiteDecisionesDeConversion: false,
    };
  }
  if (observado < minimo.valor) {
    return {
      veredicto: 'INSUFFICIENT',
      motivo: `hacen falta ${minimo.valor} ${minimo.metrica.toLowerCase()} y hay ${Math.round(observado)}`,
      minimoExigido: minimo, observado, permiteDecisionesDeConversion: false,
    };
  }

  // 5. SUFICIENTE para tráfico. Para CONVERSIONES, además, la medición tiene que estar sana.
  const permiteConversion = e.saludMedicion === 'HEALTHY';
  return {
    veredicto: 'SUFFICIENT',
    motivo: permiteConversion
      ? `hay ${Math.round(observado)} ${minimo.metrica.toLowerCase()} en ${e.ventana.dias} días y la medición está sana`
      : `hay ${Math.round(observado)} ${minimo.metrica.toLowerCase()}, pero la medición está ${e.saludMedicion === 'DEGRADED' ? 'degradada' : 'sin verificar'}: no se decide por conversiones`,
    minimoExigido: minimo, observado, permiteDecisionesDeConversion: permiteConversion,
  };
}

/** ¿Esta decisión depende de conversiones? Si la medición está enferma, no se puede tomar. */
export function dependeDeConversiones(accion: string): boolean {
  return accion === 'PAUSE_KEYWORD' || accion === 'ADJUST_DAILY_BUDGET' || accion === 'ADJUST_MAX_CPC';
}
