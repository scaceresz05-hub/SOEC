/**
 * @soec/crm-comercial · dominio · Contrato de EXPLICABILIDAD y EVALUABILIDAD.
 *
 * Generaliza, fuera de `@soec/estrategia`, la forma de una "recomendación explicada": nunca se
 * responde "recomiendo X" a secas. Toda salida analítica es una UNIÓN DISCRIMINADA con una rama de
 * ABSTENCIÓN de primera clase (Evaluabilidad: la ausencia de información nunca es una conclusión).
 * Reutiliza el vocabulario epistémico canónico de `@soec/negocio` (origen de evidencia y confianza).
 */
import type { Confianza, TipoEvidencia } from '@soec/negocio';

export type { Confianza, TipoEvidencia };
export { confianzaPorDefecto } from '@soec/negocio';

/** Banda cualitativa de una magnitud (para no fingir precisión donde no la hay). */
export type Banda = 'ALTA' | 'MEDIA' | 'BAJA';

/** Un factor que empuja una conclusión en un sentido, con su evidencia de respaldo. */
export interface Factor {
  readonly descripcion: string;
  readonly efecto: 'SUBE' | 'BAJA' | 'NEUTRO';
  /** Referencia a la evidencia usada (id de actividad/atributo) o naturaleza epistémica. */
  readonly evidencia?: string;
  readonly origen?: TipoEvidencia;
}

/** Una alternativa considerada y DESCARTADA, siempre con su motivo (nunca se oculta). */
export interface AlternativaDescartada {
  readonly accion: string;
  readonly motivo: string;
}

/** Recomendación con razones, evidencia, alternativas descartadas, confianza y qué falta saber. */
export interface Recomendacion {
  readonly tipo: 'RECOMENDACION';
  readonly accion: string;
  readonly razones: readonly string[];
  readonly evidenciaUsada: readonly string[];
  readonly alternativasDescartadas: readonly AlternativaDescartada[];
  readonly confianza: Confianza;
  readonly queFalta: readonly string[];
}

/** Abstención honesta: no hay base suficiente para recomendar; se declaran los faltantes. */
export interface Abstencion {
  readonly tipo: 'ABSTENCION';
  readonly motivo: string;
  readonly faltantes: readonly string[];
}

/** Salida del "siguiente paso recomendado" y demás respuestas del CRM inteligente. */
export type RecomendacionExplicada = Recomendacion | Abstencion;

export function esRecomendacion(r: RecomendacionExplicada): r is Recomendacion {
  return r.tipo === 'RECOMENDACION';
}
