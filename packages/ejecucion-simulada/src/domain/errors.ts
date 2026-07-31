/** Errores de dominio de @soec/ejecucion-simulada. Operacionales. */

export class EjecucionInvalidaError extends Error {
  readonly code = 'EJECUCION_INVALIDA';
  constructor(message: string) {
    super(message);
    this.name = 'EjecucionInvalidaError';
  }
}

/** Se intentó ejecutar sobre un contenido de otra organización. */
export class SeparacionEjecucionVioladaError extends Error {
  readonly code = 'SEPARACION_EJECUCION_VIOLADA';
  constructor(message: string) {
    super(message);
    this.name = 'SeparacionEjecucionVioladaError';
  }
}
