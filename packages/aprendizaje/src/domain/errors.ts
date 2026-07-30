/** Errores de dominio de @soec/aprendizaje. Operacionales. */

/** El aprendizaje está mal formado (faltan capas, texto libre en vez de estructura, etc.). */
export class AprendizajeInvalidoError extends Error {
  readonly code = 'APRENDIZAJE_INVALIDO';
  constructor(message: string) {
    super(message);
    this.name = 'AprendizajeInvalidoError';
  }
}

/**
 * Se intentó aplicar un aprendizaje a otra organización sin una decisión humana explícita.
 * El conocimiento NO se transfiere solo entre organizaciones.
 */
export class AplicacionSinDecisionHumanaError extends Error {
  readonly code = 'APLICACION_SIN_DECISION_HUMANA';
  constructor(message: string) {
    super(message);
    this.name = 'AplicacionSinDecisionHumanaError';
  }
}
