/** Errores del dominio de conocimiento de negocio. */
export class ConocimientoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ConocimientoInvalidoError';
  }
}

/** Intento de escribir/leer conocimiento de una organización distinta a la del contexto. */
export class SeparacionVioladaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'SeparacionVioladaError';
  }
}
