/**
 * Indicadores derivados (F2-MET-01 §4.4, §12). Motor DETERMINISTA de fórmulas
 * versionadas (sin LLM en la aritmética central). Evita la división por cero,
 * representa valores no calculables, conserva entradas, cobertura y advertencias, y
 * distingue estimado de confirmado.
 */
import type { MetricaCanonica } from './vocabulary';

export type TipoIndicador =
  | 'ctr'
  | 'tasa_interaccion'
  | 'tasa_apertura'
  | 'tasa_respuesta'
  | 'tasa_conversion'
  | 'cpl'
  | 'cpa'
  | 'roas'
  | 'roi'
  | 'costo_por_clic'
  | 'frecuencia'
  | 'variacion_linea_base';

export const INDICADOR_VERSION = 'indicadores@1';

export interface Indicador {
  readonly tipo: TipoIndicador;
  readonly valor: number | null; // null = no calculable
  readonly formula: string;
  readonly version: string;
  readonly entradas: Readonly<Record<string, number>>;
  readonly cobertura: number;
  readonly confianza: 'estimada' | 'confirmada';
  readonly advertencias: readonly string[];
}

type Metricas = Partial<Record<MetricaCanonica, number>>;

function ind(tipo: TipoIndicador, formula: string, entradas: Record<string, number>, valor: number | null, advertencias: string[], estimada: boolean): Indicador {
  const claves = Object.values(entradas);
  const cobertura = claves.length === 0 ? 0 : claves.filter((v) => v > 0 || v === 0).length / claves.length;
  return { tipo, valor, formula, version: INDICADOR_VERSION, entradas, cobertura, confianza: estimada ? 'estimada' : 'confirmada', advertencias };
}

/** Ratio seguro: null si el denominador es 0 (no calculable), con advertencia. */
function ratio(num: number, den: number, adv: string[]): number | null {
  if (den === 0) {
    adv.push('denominador cero: indicador no calculable');
    return null;
  }
  return num / den;
}

export function calcularIndicador(tipo: TipoIndicador, m: Metricas, lineaBase?: number, estimada = false): Indicador {
  const adv: string[] = [];
  const g = (k: MetricaCanonica) => m[k] ?? 0;
  switch (tipo) {
    case 'ctr':
      return ind('ctr', 'clics / impresiones', { clics: g('clics'), impresiones: g('impresiones') }, ratio(g('clics'), g('impresiones'), adv), adv, estimada);
    case 'tasa_conversion':
      return ind('tasa_conversion', 'conversiones / clics', { conversiones: g('conversiones'), clics: g('clics') }, ratio(g('conversiones'), g('clics'), adv), adv, estimada);
    case 'tasa_interaccion':
      return ind('tasa_interaccion', 'interacciones / impresiones', { interacciones: g('interacciones'), impresiones: g('impresiones') }, ratio(g('interacciones'), g('impresiones'), adv), adv, estimada);
    case 'tasa_apertura':
      return ind('tasa_apertura', 'aperturas / impresiones', { aperturas: g('aperturas'), impresiones: g('impresiones') }, ratio(g('aperturas'), g('impresiones'), adv), adv, estimada);
    case 'tasa_respuesta':
      return ind('tasa_respuesta', 'respuestas / impresiones', { respuestas: g('respuestas'), impresiones: g('impresiones') }, ratio(g('respuestas'), g('impresiones'), adv), adv, estimada);
    case 'cpl':
      return ind('cpl', 'gasto / leads', { gasto: g('gasto'), leads: g('leads') }, ratio(g('gasto'), g('leads'), adv), adv, estimada);
    case 'cpa':
      return ind('cpa', 'gasto / conversiones', { gasto: g('gasto'), conversiones: g('conversiones') }, ratio(g('gasto'), g('conversiones'), adv), adv, estimada);
    case 'roas':
      return ind('roas', 'ingresos_atribuidos / gasto', { ingresos: g('ingresos_atribuidos'), gasto: g('gasto') }, ratio(g('ingresos_atribuidos'), g('gasto'), adv), adv, estimada);
    case 'roi':
      return ind('roi', '(ingresos - gasto) / gasto', { ingresos: g('ingresos_atribuidos'), gasto: g('gasto') }, ratio(g('ingresos_atribuidos') - g('gasto'), g('gasto'), adv), adv, estimada);
    case 'costo_por_clic':
      return ind('costo_por_clic', 'gasto / clics', { gasto: g('gasto'), clics: g('clics') }, ratio(g('gasto'), g('clics'), adv), adv, estimada);
    case 'frecuencia':
      return ind('frecuencia', 'impresiones / alcance', { impresiones: g('impresiones'), alcance: g('alcance') }, ratio(g('impresiones'), g('alcance'), adv), adv, estimada);
    case 'variacion_linea_base': {
      const base = lineaBase ?? 0;
      return ind('variacion_linea_base', '(conversiones - base) / base', { conversiones: g('conversiones'), base }, ratio(g('conversiones') - base, base, adv), adv, estimada);
    }
    default:
      return ind(tipo, 'desconocida', {}, null, ['indicador no soportado'], estimada);
  }
}
