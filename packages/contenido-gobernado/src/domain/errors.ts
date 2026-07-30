/** Errores de dominio de @soec/contenido-gobernado. Operacionales: violan una invariante de gobierno. */

/** El contenido no puede derivarse/transicionarse como se pide (brief incompleto, estado, etc.). */
export class ContenidoGobernadoInvalidoError extends Error {
  readonly code = 'CONTENIDO_GOBERNADO_INVALIDO';
  constructor(message: string) {
    super(message);
    this.name = 'ContenidoGobernadoInvalidoError';
  }
}

/** Se intentó cruzar la frontera de organización vía una referencia externa (campaña/contexto). */
export class SeparacionContenidoVioladaError extends Error {
  readonly code = 'SEPARACION_CONTENIDO_VIOLADA';
  constructor(message: string) {
    super(message);
    this.name = 'SeparacionContenidoVioladaError';
  }
}

/** Transición no permitida (p. ej. programar contenido RECHAZADO). */
export class TransicionContenidoInvalidaError extends Error {
  readonly code = 'TRANSICION_CONTENIDO_INVALIDA';
  constructor(message: string) {
    super(message);
    this.name = 'TransicionContenidoInvalidaError';
  }
}
