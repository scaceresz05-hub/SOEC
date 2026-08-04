/**
 * @soec/motor-medicion · dominio · EVALUACIÓN DE RESULTADO (motor puro y determinista).
 *
 * Compara expectativa vs observación vs baseline vs umbral vs calidad vs cobertura. La AUSENCIA de datos
 * NUNCA es fracaso (NO_EVALUABLE, no NO_CUMPLIDO). Una métrica parcial no concluye el objetivo global.
 * Reutiliza `NivelCalidad`/`calidadAlMenos` de @soec/medicion (no reinventa la calidad). Explica siempre.
 *
 * Estados: SUPERADO · CUMPLIDO · PARCIAL · NO_CUMPLIDO · NO_EVALUABLE · INCONSISTENTE.
 */
import { type NivelCalidad, calidadAlMenos } from '@soec/medicion';

export type EstadoResultado = 'SUPERADO' | 'CUMPLIDO' | 'PARCIAL' | 'NO_CUMPLIDO' | 'NO_EVALUABLE' | 'INCONSISTENTE';
export type DireccionKpi = 'subir' | 'bajar';
export const EVALUACION_RESULTADO_VERSION = 'eval-resultado@1';

export interface ExpectativaResultado {
  readonly kpiId: string;
  readonly direccion: DireccionKpi;
  readonly baseline: number;
  readonly meta: number;
  readonly umbral: number; // mínimo aceptable (para 'subir') / máximo aceptable (para 'bajar')
  readonly muestraMinima: number;
  readonly calidadMinima: NivelCalidad;
  readonly coberturaMinima: number; // [0,1]
}

export interface Observado {
  readonly valor: number | null; // null = ausencia (nunca 0 por defecto)
  readonly calidad: NivelCalidad;
  readonly cobertura: number; // [0,1]
  readonly muestra: number;
}

export interface EvaluacionResultado {
  readonly version: string;
  readonly kpiId: string;
  readonly estado: EstadoResultado;
  readonly esperado: { readonly baseline: number; readonly umbral: number; readonly meta: number; readonly direccion: DireccionKpi };
  readonly observado: number | null;
  readonly calidad: NivelCalidad;
  readonly cobertura: number;
  readonly explicacion: string;
  readonly faltantes: readonly string[];
  readonly contradicciones: readonly string[];
}

function base(exp: ExpectativaResultado, obs: Observado): Omit<EvaluacionResultado, 'estado' | 'explicacion' | 'faltantes' | 'contradicciones'> {
  return {
    version: EVALUACION_RESULTADO_VERSION, kpiId: exp.kpiId,
    esperado: { baseline: exp.baseline, umbral: exp.umbral, meta: exp.meta, direccion: exp.direccion },
    observado: obs.valor, calidad: obs.calidad, cobertura: obs.cobertura,
  };
}

/** ¿La geometría del objetivo es coherente? (umbral entre baseline y meta según la dirección). */
function objetivoCoherente(exp: ExpectativaResultado): boolean {
  return exp.direccion === 'subir'
    ? exp.baseline <= exp.umbral && exp.umbral <= exp.meta
    : exp.meta <= exp.umbral && exp.umbral <= exp.baseline;
}

export function evaluarResultado(exp: ExpectativaResultado, obs: Observado): EvaluacionResultado {
  const b = base(exp, obs);
  const contradicciones: string[] = [];
  const faltantes: string[] = [];

  // INCONSISTENTE: objetivo mal formado, o valor presente con calidad "no disponible" (contradicción).
  if (!objetivoCoherente(exp)) contradicciones.push('la geometría del objetivo (baseline/umbral/meta) es incoherente con la dirección');
  if (obs.valor !== null && obs.calidad === 'no_disponible') contradicciones.push('hay valor pero la calidad es "no disponible"');
  if (obs.cobertura < 0 || obs.cobertura > 1) contradicciones.push('cobertura fuera de rango [0,1]');
  if (contradicciones.length > 0) {
    return { ...b, estado: 'INCONSISTENTE', explicacion: 'existen contradicciones que impiden una conclusión honesta', faltantes, contradicciones };
  }

  // NO_EVALUABLE: ausencia de valor, o evidencia insuficiente (calidad/cobertura/muestra). Ausencia ≠ fracaso.
  if (obs.valor === null || obs.calidad === 'no_disponible') faltantes.push('valor observado');
  if (!calidadAlMenos(obs.calidad, exp.calidadMinima)) faltantes.push(`calidad ≥ ${exp.calidadMinima}`);
  if (obs.cobertura < exp.coberturaMinima) faltantes.push(`cobertura ≥ ${exp.coberturaMinima}`);
  if (obs.muestra < exp.muestraMinima) faltantes.push(`muestra ≥ ${exp.muestraMinima}`);
  if (faltantes.length > 0) {
    return { ...b, estado: 'NO_EVALUABLE', explicacion: 'la evidencia es insuficiente para concluir; la ausencia no implica un resultado negativo', faltantes, contradicciones };
  }

  const v = obs.valor as number;
  const mejor = exp.direccion === 'subir'
    ? { superado: v >= exp.meta, cumplido: v >= exp.umbral, parcial: v > exp.baseline }
    : { superado: v <= exp.meta, cumplido: v <= exp.umbral, parcial: v < exp.baseline };
  const estado: EstadoResultado = mejor.superado ? 'SUPERADO' : mejor.cumplido ? 'CUMPLIDO' : mejor.parcial ? 'PARCIAL' : 'NO_CUMPLIDO';
  const explicacion = {
    SUPERADO: `observado ${v} supera la meta ${exp.meta}`,
    CUMPLIDO: `observado ${v} alcanza el umbral ${exp.umbral} pero no la meta ${exp.meta}`,
    PARCIAL: `observado ${v} mejora respecto de baseline ${exp.baseline} pero no alcanza el umbral ${exp.umbral}`,
    NO_CUMPLIDO: `observado ${v} no mejora respecto de baseline ${exp.baseline}`,
  }[estado];
  return { ...b, estado, explicacion, faltantes, contradicciones };
}
