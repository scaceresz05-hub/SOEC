/**
 * @soec/motor-medicion · dominio · CONSOLIDACIÓN ENTRE EXPERIMENTOS (motor puro y determinista).
 *
 * Combina múltiples evaluaciones SOLO si son compatibles en hipótesis, segmento, KPI, definición de métrica,
 * ventana, naturaleza, política de atribución y contexto. Las incompatibles se EXCLUYEN con su motivo (nunca
 * se promedian). No se cuenta dos veces la misma observación. Una única ejecución NO genera conocimiento
 * transferible. Una contradicción relevante reduce la confianza o impide concluir. Multi-tenant a nivel de
 * llamador (todas las evaluaciones son de la misma organización). La naturaleza SIMULADA se conserva.
 *
 * Estados: RESPALDADA · REFUTADA · PARCIAL · INCONCLUSA · NO_EVALUABLE · NO_COMPARABLES.
 */
import type { Confianza, EstadoHipotesis } from './evaluacion-hipotesis';

export const CONSOLIDACION_VERSION = 'consolidacion@1';

export interface ClaveComparacion {
  readonly hipotesisId: string;
  readonly segmento: string;
  readonly kpiId: string;
  readonly definicionMetrica: string;
  readonly ventana: string;
  readonly naturaleza: string;
  readonly politicaAtribucion: string;
  readonly contexto: string;
}

export interface EntradaConsolidacion {
  readonly evaluacionId: string;
  readonly observacionId: string;
  readonly clave: ClaveComparacion;
  readonly estadoHipotesis: EstadoHipotesis;
}

export type EstadoConsolidacion = 'RESPALDADA' | 'REFUTADA' | 'PARCIAL' | 'INCONCLUSA' | 'NO_EVALUABLE' | 'NO_COMPARABLES';

export interface Consolidacion {
  readonly version: string;
  readonly estado: EstadoConsolidacion;
  readonly hipotesisId: string;
  readonly incluidas: readonly string[]; // evaluacionIds incluidas
  readonly excluidas: readonly { readonly evaluacionId: string; readonly motivo: string }[];
  readonly experimentosUnicos: number; // observaciones únicas (sin doble conteo)
  readonly respaldos: number;
  readonly refutaciones: number;
  readonly confianza: Confianza;
  readonly alcance: 'LOCAL' | 'TRANSFERIBLE';
  readonly contradicciones: readonly string[];
  readonly explicacion: string;
}

function diferencias(a: ClaveComparacion, b: ClaveComparacion): string[] {
  const dif: string[] = [];
  (Object.keys(a) as (keyof ClaveComparacion)[]).forEach((k) => { if (a[k] !== b[k]) dif.push(String(k)); });
  return dif;
}

export function consolidar(clave: ClaveComparacion, entradas: readonly EntradaConsolidacion[]): Consolidacion {
  const base = { version: CONSOLIDACION_VERSION, hipotesisId: clave.hipotesisId };
  const incluidas: string[] = [];
  const excluidas: { evaluacionId: string; motivo: string }[] = [];
  const porObservacion = new Map<string, EstadoHipotesis>(); // dedup: una observación cuenta una vez

  for (const e of entradas) {
    const dif = diferencias(clave, e.clave);
    if (dif.length > 0) { excluidas.push({ evaluacionId: e.evaluacionId, motivo: `incompatible en: ${dif.join(', ')}` }); continue; }
    incluidas.push(e.evaluacionId);
    if (!porObservacion.has(e.observacionId)) porObservacion.set(e.observacionId, e.estadoHipotesis); // no doble conteo
  }

  const estados = [...porObservacion.values()];
  const respaldos = estados.filter((s) => s === 'RESPALDADA').length;
  const refutaciones = estados.filter((s) => s === 'REFUTADA').length;
  const experimentosUnicos = estados.length;

  // Si hubo entradas pero TODAS se excluyeron ⇒ NO_COMPARABLES.
  if (incluidas.length === 0 && excluidas.length > 0) {
    return { ...base, estado: 'NO_COMPARABLES', incluidas, excluidas, experimentosUnicos: 0, respaldos: 0, refutaciones: 0, confianza: 'nula', alcance: 'LOCAL', contradicciones: [], explicacion: 'todas las evaluaciones son incomparables; prohibido promediar' };
  }
  if (experimentosUnicos === 0) {
    return { ...base, estado: 'NO_EVALUABLE', incluidas, excluidas, experimentosUnicos, respaldos, refutaciones, confianza: 'nula', alcance: 'LOCAL', contradicciones: [], explicacion: 'sin experimentos evaluables comparables' };
  }
  const contradiccion = respaldos > 0 && refutaciones > 0;
  const contradicciones = contradiccion ? [`respaldos ${respaldos} vs refutaciones ${refutaciones} en experimentos comparables`] : [];

  // Una sola observación única ⇒ NO generaliza: alcance LOCAL, resultado según su estado, confianza baja.
  if (experimentosUnicos === 1) {
    const est = estados[0]!;
    const estado: EstadoConsolidacion = est === 'RESPALDADA' ? 'RESPALDADA' : est === 'REFUTADA' ? 'REFUTADA' : est === 'PARCIAL' ? 'PARCIAL' : est === 'INCONCLUSA' ? 'INCONCLUSA' : 'NO_EVALUABLE';
    return { ...base, estado, incluidas, excluidas, experimentosUnicos, respaldos, refutaciones, confianza: 'baja', alcance: 'LOCAL', contradicciones, explicacion: 'una sola observación única: no transferible (local)' };
  }
  if (contradiccion) {
    return { ...base, estado: 'INCONCLUSA', incluidas, excluidas, experimentosUnicos, respaldos, refutaciones, confianza: 'baja', alcance: 'LOCAL', contradicciones, explicacion: 'evidencia contradictoria entre experimentos comparables: no concluye' };
  }
  const consistenteRespaldo = respaldos >= 2 && refutaciones === 0;
  const consistenteRefuta = refutaciones >= 2 && respaldos === 0;
  if (consistenteRespaldo) return { ...base, estado: 'RESPALDADA', incluidas, excluidas, experimentosUnicos, respaldos, refutaciones, confianza: 'alta', alcance: 'TRANSFERIBLE', contradicciones, explicacion: 'respaldo consistente en múltiples experimentos comparables' };
  if (consistenteRefuta) return { ...base, estado: 'REFUTADA', incluidas, excluidas, experimentosUnicos, respaldos, refutaciones, confianza: 'alta', alcance: 'LOCAL', contradicciones, explicacion: 'refutación consistente en múltiples experimentos comparables' };
  return { ...base, estado: 'PARCIAL', incluidas, excluidas, experimentosUnicos, respaldos, refutaciones, confianza: 'media', alcance: 'LOCAL', contradicciones, explicacion: 'señal parcial: sin consistencia suficiente para transferir' };
}
