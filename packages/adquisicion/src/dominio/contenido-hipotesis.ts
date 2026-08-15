/**
 * ContentHypothesis — por qué existe cada pieza de contenido.
 *
 * Nunca "publicar porque toca publicar". Toda pieza responde: qué comunico, a quién, qué
 * problema/necesidad, qué producto/servicio, qué evidencia comercial lo respalda, qué CTA, qué
 * resultado espero. Sin evidencia comercial, la hipótesis NO es evaluable y el contenido no puede
 * salir de borrador. No reimplementa el brief de `@soec/contenido`; expresa la hipótesis previa,
 * provider-neutral, que justifica crear contenido.
 */

import type { ObjetivoComercial } from './objetivo';
import type { CanalAdquisicion } from './canal';
import type { ResultadoAdquisicion } from './resultado';

export interface HipotesisContenido {
  readonly organizationId: string;
  readonly objetivo: ObjetivoComercial;
  readonly canal: CanalAdquisicion;
  /** Descriptor del segmento — nunca PII de personas concretas. */
  readonly audiencia: string;
  readonly problemaONecesidad: string;
  readonly productoServicio: string;
  /** Referencias a evidencia comercial (ventas observadas, conocimiento del negocio). */
  readonly evidenciaComercial: readonly string[];
  readonly cta: string;
  readonly resultadoEsperado: ResultadoAdquisicion;
}

export interface EvaluacionHipotesis {
  readonly evaluable: boolean;
  readonly faltantes: readonly string[];
}

/**
 * Una hipótesis es evaluable sólo si están todos sus componentes y, en particular, si trae al menos
 * una evidencia comercial. La ausencia de evidencia no es una conclusión: es un faltante declarado.
 */
export function evaluarHipotesis(h: HipotesisContenido): EvaluacionHipotesis {
  const faltantes: string[] = [];
  if (h.problemaONecesidad.trim() === '') faltantes.push('problemaONecesidad');
  if (h.productoServicio.trim() === '') faltantes.push('productoServicio');
  if (h.cta.trim() === '') faltantes.push('cta');
  if (h.audiencia.trim() === '') faltantes.push('audiencia');
  if (h.evidenciaComercial.length === 0) faltantes.push('evidenciaComercial');
  return { evaluable: faltantes.length === 0, faltantes };
}
