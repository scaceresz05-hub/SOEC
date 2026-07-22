import { SoecError } from '@soec/contracts';

/** El objetivo no es evaluable (faltantes) o está mal formado (imposible). */
export class ObjetivoNoEvaluableError extends SoecError {}
/** El objetivo referenciado no existe. */
export class ObjetivoNoEncontradoError extends SoecError {}
/** El plan solicitado no existe. */
export class PlanNoEncontradoError extends SoecError {}
/** No hay una acción ejecutable disponible en el plan. */
export class SinAccionDisponibleError extends SoecError {}
/** Dato obligatorio ausente en un comando de marketing. */
export class ComandoMarketingInvalidoError extends SoecError {}
/** La actividad no puede prepararse con contenido (no está bloqueada por contenido_faltante). */
export class ActividadNoPreparableError extends SoecError {}
