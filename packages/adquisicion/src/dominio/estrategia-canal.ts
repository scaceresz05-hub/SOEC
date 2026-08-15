/**
 * ChannelStrategyDecision — qué canal, por qué, con qué evidencia y cuánta confianza.
 *
 * SOEC debe poder decir "Google / Meta / Orgánico / Email" con un razonamiento explícito, sin reglas
 * cableadas del tipo "Meta siempre para C Y P". Reutiliza la forma probada de decisión con
 * evidencia+confianza+abstención de `@soec/estrategia` y `@soec/decisiones-mkt`, añadiendo la
 * DIMENSIÓN DE CANAL que a aquéllas les falta.
 */

import type { CanalAdquisicion } from './canal';
import type { ObjetivoComercial } from './objetivo';
import type { ResultadoAdquisicion } from './resultado';

export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA' | 'NULA';
export type PreparacionMedicion = 'READY' | 'PARTIAL' | 'NOT_READY';
export type NivelRiesgo = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RangoCosto {
  readonly moneda: string;
  readonly min: number | null;
  readonly max: number | null;
}

export interface DecisionEstrategiaCanal {
  readonly organizationId: string;
  readonly objetivo: ObjetivoComercial;
  readonly canal: CanalAdquisicion;
  readonly why: string;
  readonly evidencia: readonly string[];
  readonly resultadoEsperado: ResultadoAdquisicion;
  readonly riesgo: NivelRiesgo;
  readonly rangoCosto: RangoCosto;
  readonly preparacionMedicion: PreparacionMedicion;
  readonly confianza: Confianza;
}

/**
 * Una recomendación de canal sólo es accionable si hay evidencia y la medición está lista o parcial.
 * Sin evidencia, la confianza cae a NULA — no se recomienda invertir a ciegas.
 */
export function decisionAccionable(d: DecisionEstrategiaCanal): boolean {
  return d.evidencia.length > 0 && d.confianza !== 'NULA' && d.preparacionMedicion !== 'NOT_READY';
}
