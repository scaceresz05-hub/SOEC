/** Errores de dominio de @soec/identity. El `code` guía el mapeo a HTTP. */

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Entrada inválida (400). */
export class EntradaInvalidaError extends IdentityError {
  constructor(message: string) {
    super(message, 'ENTRADA_INVALIDA', 400);
  }
}
/** No autenticado / credenciales inválidas (401). Mensaje genérico para no enumerar. */
export class NoAutenticadoError extends IdentityError {
  constructor(message = 'credenciales inválidas') {
    super(message, 'NO_AUTENTICADO', 401);
  }
}
/** Autenticado sin permiso (403). */
export class SinPermisoError extends IdentityError {
  constructor(message = 'permiso insuficiente') {
    super(message, 'SIN_PERMISO', 403);
  }
}
/** Recurso inexistente o no visible para el actor (404). */
export class NoEncontradoError extends IdentityError {
  constructor(message = 'recurso no encontrado') {
    super(message, 'NO_ENCONTRADO', 404);
  }
}
/** Conflicto: unicidad, estado (409). */
export class ConflictoError extends IdentityError {
  constructor(message: string) {
    super(message, 'CONFLICTO', 409);
  }
}
/** Política de dominio que prohíbe la operación (409). */
export class PoliticaError extends IdentityError {
  constructor(message: string) {
    super(message, 'POLITICA', 409);
  }
}
