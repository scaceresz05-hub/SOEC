/** Errores del dominio de decisión de marketing. */
export class DecisionMktInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DecisionMktInvalidaError';
  }
}

/** Transición de estado no permitida por la máquina de estados. */
export class TransicionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'TransicionInvalidaError';
  }
}
