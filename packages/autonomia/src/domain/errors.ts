/** Errores de dominio de @soec/autonomia. Operacionales: violan una invariante de seguridad. */

/** Operación de autonomía inválida (acción sin autorización, continuar tras pausa, etc.). */
export class AutonomiaInvalidaError extends Error {
  readonly code = 'AUTONOMIA_INVALIDA';
  constructor(message: string) {
    super(message);
    this.name = 'AutonomiaInvalidaError';
  }
}

/** SOEC intentó elevar su propio nivel de autonomía. Sólo un humano puede hacerlo. */
export class AutonomiaNoAutoElevableError extends Error {
  readonly code = 'AUTONOMIA_NO_AUTO_ELEVABLE';
  constructor(message: string) {
    super(message);
    this.name = 'AutonomiaNoAutoElevableError';
  }
}

/** Se intentó reanudar el sistema sin un actor humano que responda por ello. */
export class ReanudacionSinActorHumanoError extends Error {
  readonly code = 'REANUDACION_SIN_ACTOR_HUMANO';
  constructor(message: string) {
    super(message);
    this.name = 'ReanudacionSinActorHumanoError';
  }
}
