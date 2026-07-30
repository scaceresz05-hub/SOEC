/** Errores de dominio de @soec/campanias. Operacionales: violan una invariante de gobierno. */

/** La campaña no puede derivarse de la decisión dada (huérfana, no ejecutable, presupuesto, hipótesis…). */
export class CampaniaInvalidaError extends Error {
  readonly code = 'CAMPANIA_INVALIDA';
  constructor(message: string) {
    super(message);
    this.name = 'CampaniaInvalidaError';
  }
}

/** Se intentó cruzar la frontera de organización (decisión de otra org, contexto ajeno). */
export class SeparacionCampaniaVioladaError extends Error {
  readonly code = 'SEPARACION_CAMPANIA_VIOLADA';
  constructor(message: string) {
    super(message);
    this.name = 'SeparacionCampaniaVioladaError';
  }
}

/** Transición de estado no permitida por la máquina de estados de la campaña. */
export class TransicionCampaniaInvalidaError extends Error {
  readonly code = 'TRANSICION_CAMPANIA_INVALIDA';
  constructor(message: string) {
    super(message);
    this.name = 'TransicionCampaniaInvalidaError';
  }
}
