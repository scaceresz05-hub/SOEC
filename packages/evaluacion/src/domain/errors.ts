/** Errores del dominio de evaluación (captura del Director). */
export class EvaluacionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'EvaluacionInvalidaError';
  }
}
