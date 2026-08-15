/**
 * OutcomeLink — el lazo cerrado campaña → grupo → anuncio → interacción → lead/sesión → resultado.
 *
 * SOEC debe poder enlazar la cadena SIN inventar causalidad. La confianza del enlace se DERIVA del
 * nivel de atribución de la evidencia; un enlace con atribución UNKNOWN nunca se presenta como
 * causal. Hoy las piezas existen dispersas (campaignRef, leadRef, MedState) pero no encadenadas.
 */

import type { EvidenciaAtribucion } from './atribucion';
import type { ResultadoAdquisicion } from './resultado';

export type MetodoAtribucion = 'PROVIDER_CLICK_ID' | 'UTM' | 'CHANNEL_SIGNAL' | 'MODELED' | 'NONE';

export interface EnlaceResultado {
  readonly organizationId: string;
  readonly campaignRef: string | null;
  readonly distributionGroupRef: string | null;
  readonly adRef: string | null;
  readonly creativeRef: string | null;
  readonly interactionRef: string | null;
  /** Uno de los dos, pseudónimo; nunca PII. */
  readonly leadRef: string | null;
  readonly sessionRef: string | null;
  readonly outcome: ResultadoAdquisicion;
  readonly attribution: EvidenciaAtribucion;
  readonly confidence: 'ALTA' | 'MEDIA' | 'BAJA' | 'NULA';
  readonly attributionMethod: MetodoAtribucion;
}

/** Deriva confianza y método a partir del nivel de atribución — nunca al revés. */
export function derivarConfianzaEnlace(ev: EvidenciaAtribucion): {
  confidence: EnlaceResultado['confidence'];
  attributionMethod: MetodoAtribucion;
} {
  switch (ev.nivel) {
    case 'DIRECT':
      return { confidence: 'ALTA', attributionMethod: 'PROVIDER_CLICK_ID' };
    case 'ATTRIBUTED':
      return { confidence: 'MEDIA', attributionMethod: 'UTM' };
    case 'OBSERVED':
      return { confidence: 'BAJA', attributionMethod: 'CHANNEL_SIGNAL' };
    case 'PROBABLE':
      return { confidence: 'BAJA', attributionMethod: 'MODELED' };
    case 'UNKNOWN':
      return { confidence: 'NULA', attributionMethod: 'NONE' };
  }
}

export function construirEnlace(
  base: Omit<EnlaceResultado, 'confidence' | 'attributionMethod'>,
): EnlaceResultado {
  const { confidence, attributionMethod } = derivarConfianzaEnlace(base.attribution);
  return { ...base, confidence, attributionMethod };
}
