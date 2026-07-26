/** Errores del dominio de decisión institucional. */
export class DecisionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DecisionInvalidaError';
  }
}

export class AutorizacionDenegadaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'AutorizacionDenegadaError';
  }
}
