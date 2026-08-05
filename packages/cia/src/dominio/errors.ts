/**
 * @soec/cia · dominio · errores del Centro de Integraciones Autónomas (capa de producto sobre la PCE).
 */
export class CiaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** El modo REAL está bloqueado en preparación cerrada (AUTONOMOUS_REAL = false). */
export class ModoRealBloqueadoError extends CiaError {}
/** La capacidad de marketing solicitada no existe en el catálogo neutral. */
export class CapacidadDesconocidaError extends CiaError {}
/** Comando inválido (falta un dato obligatorio o un acto humano requerido). */
export class ComandoCiaInvalidoError extends CiaError {}
/** Misma clave lógica con contenido distinto: conflicto de idempotencia gobernado. */
export class ConflictoIdempotenciaError extends CiaError {}
