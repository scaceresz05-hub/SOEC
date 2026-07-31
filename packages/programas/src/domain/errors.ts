/** Errores de dominio de @soec/programas. Operacionales. */

/** Negocio inválido o inexistente. */
export class NegocioInvalidoError extends Error {
  readonly code = 'NEGOCIO_INVALIDO';
  constructor(message: string) {
    super(message);
    this.name = 'NegocioInvalidoError';
  }
}

/** Programa inválido, incompleto o inexistente. */
export class ProgramaInvalidoError extends Error {
  readonly code = 'PROGRAMA_INVALIDO';
  constructor(message: string) {
    super(message);
    this.name = 'ProgramaInvalidoError';
  }
}

/** El programa no está en condiciones de ejecutarse (config incompleta o presupuesto excedido). */
export class ProgramaNoEjecutableError extends Error {
  readonly code = 'PROGRAMA_NO_EJECUTABLE';
  constructor(message: string) {
    super(message);
    this.name = 'ProgramaNoEjecutableError';
  }
}

/** Se intentó cruzar la frontera de organización. */
export class SeparacionProgramaVioladaError extends Error {
  readonly code = 'SEPARACION_PROGRAMA_VIOLADA';
  constructor(message: string) {
    super(message);
    this.name = 'SeparacionProgramaVioladaError';
  }
}
