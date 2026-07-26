/**
 * @soec/rubros · dominio · semántica del conocimiento regulatorio.
 *
 * Criterio 5: el paquete impide que una entrada regulatoria PRELIMINARY se presente
 * como cumplimiento confirmado. Una regla en revisión puede ADVERTIR y BLOQUEAR de
 * forma conservadora, pero NUNCA certificar cumplimiento legal. La certificación
 * solo es posible cuando la regla está RATIFIED y VERIFIED.
 */
import type { Regulatorio } from './tipos';

export interface SemanticaRegulatoria {
  /** Puede usarse para advertir al usuario/motor. */
  readonly puedeAdvertir: boolean;
  /** Puede usarse para descartar una estrategia de forma conservadora. */
  readonly puedeBloquearConservador: boolean;
  /** Puede usarse para AFIRMAR cumplimiento legal (solo RATIFIED + VERIFIED). */
  readonly puedeCertificarCumplimiento: boolean;
}

export function semanticaRegulatoria(e: Regulatorio): SemanticaRegulatoria {
  const vigente = e.estado !== 'DEPRECATED' && e.estado !== 'DRAFT';
  const certificable = e.estado === 'RATIFIED' && e.verificacion === 'VERIFIED';
  return {
    puedeAdvertir: vigente,
    puedeBloquearConservador: vigente,
    puedeCertificarCumplimiento: certificable,
  };
}

export class CertificacionNoPermitidaError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(
      `No se puede certificar cumplimiento con la regla ${id}: el conocimiento regulatorio no está RATIFIED/VERIFIED (solo puede advertir o bloquear conservadoramente).`,
    );
    this.name = 'CertificacionNoPermitidaError';
    this.id = id;
  }
}

/**
 * Guarda honesta: NO certifica nada; verifica si la regla PUEDE afirmar cumplimiento
 * y lanza cuando no puede (PRELIMINARY / no verificada). Devuelve `true` solo cuando
 * la certificación está permitida (RATIFIED + VERIFIED).
 */
export function verificarCapacidadDeCertificacion(e: Regulatorio): true {
  if (!semanticaRegulatoria(e).puedeCertificarCumplimiento) {
    throw new CertificacionNoPermitidaError(e.id);
  }
  return true;
}
