/**
 * Overlay de adquisición sobre el catálogo de acciones CANÓNICO de `@soec/autonomia`.
 *
 * NO es un catálogo paralelo: `AccionSocialTipo` es una PROYECCIÓN (subconjunto) de la unión cerrada
 * `TipoAccion` de `@soec/autonomia`; las propiedades intrínsecas (reversibilidad × financiera × gasto)
 * se delegan a `metaDeAccion` de ese paquete. Aquí sólo se añade la metadata propia de la capa de
 * adquisición: naturaleza (orgánico/pagado × lectura/escritura) y clase de riesgo, y la clasificación
 * de este bloque: REAL prohibido, SHADOW permitido según el mandato.
 */

import type { TipoAccion, Reversibilidad } from '@soec/autonomia';
import { metaDeAccion } from '@soec/autonomia';

export type ClaseRiesgo = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Subconjunto social de la unión canónica `TipoAccion` — proyección, no redefinición. */
export type AccionSocialTipo = Extract<
  TipoAccion,
  | 'SOCIAL_INSIGHTS_READ'
  | 'SOCIAL_POST_CREATE_DRAFT'
  | 'SOCIAL_POST_SCHEDULE'
  | 'SOCIAL_POST_PUBLISH'
  | 'PAID_CAMPAIGN_CREATE'
  | 'PAID_CAMPAIGN_PAUSE'
  | 'PAID_CAMPAIGN_RESUME'
  | 'PAID_AD_CREATE'
  | 'PAID_AD_PAUSE'
  | 'PAID_BUDGET_ADJUST'
>;

export type NaturalezaAccionSocial = 'ORGANIC_READ' | 'ORGANIC_WRITE' | 'PAID_WRITE';

/** Metadata de la capa de adquisición (naturaleza + riesgo). Los flags intrínsecos vienen de autonomía. */
export interface OverlayAccionSocial {
  readonly tipo: AccionSocialTipo;
  readonly naturaleza: NaturalezaAccionSocial;
  readonly riesgo: ClaseRiesgo;
}

export const OVERLAY_ACCION_SOCIAL: Record<AccionSocialTipo, OverlayAccionSocial> = {
  SOCIAL_INSIGHTS_READ: { tipo: 'SOCIAL_INSIGHTS_READ', naturaleza: 'ORGANIC_READ', riesgo: 'LOW' },
  SOCIAL_POST_CREATE_DRAFT: { tipo: 'SOCIAL_POST_CREATE_DRAFT', naturaleza: 'ORGANIC_WRITE', riesgo: 'LOW' },
  SOCIAL_POST_SCHEDULE: { tipo: 'SOCIAL_POST_SCHEDULE', naturaleza: 'ORGANIC_WRITE', riesgo: 'MEDIUM' },
  SOCIAL_POST_PUBLISH: { tipo: 'SOCIAL_POST_PUBLISH', naturaleza: 'ORGANIC_WRITE', riesgo: 'MEDIUM' },
  PAID_CAMPAIGN_CREATE: { tipo: 'PAID_CAMPAIGN_CREATE', naturaleza: 'PAID_WRITE', riesgo: 'HIGH' },
  PAID_CAMPAIGN_PAUSE: { tipo: 'PAID_CAMPAIGN_PAUSE', naturaleza: 'PAID_WRITE', riesgo: 'MEDIUM' },
  PAID_CAMPAIGN_RESUME: { tipo: 'PAID_CAMPAIGN_RESUME', naturaleza: 'PAID_WRITE', riesgo: 'HIGH' },
  PAID_AD_CREATE: { tipo: 'PAID_AD_CREATE', naturaleza: 'PAID_WRITE', riesgo: 'HIGH' },
  PAID_AD_PAUSE: { tipo: 'PAID_AD_PAUSE', naturaleza: 'PAID_WRITE', riesgo: 'MEDIUM' },
  PAID_BUDGET_ADJUST: { tipo: 'PAID_BUDGET_ADJUST', naturaleza: 'PAID_WRITE', riesgo: 'CRITICAL' },
};

export function overlayDeAccionSocial(tipo: AccionSocialTipo): OverlayAccionSocial {
  return OVERLAY_ACCION_SOCIAL[tipo];
}

export type ModoPermitido = 'FORBIDDEN' | 'ALLOWED';

/**
 * Clasificación de este bloque: TODA acción REAL está prohibida; sólo SHADOW se permite. Sin
 * excepciones — la ejecución real llega en el capítulo de onboarding con credenciales.
 */
export function clasificacionInicial(_tipo: AccionSocialTipo): { real: ModoPermitido; shadow: ModoPermitido } {
  return { real: 'FORBIDDEN', shadow: 'ALLOWED' };
}

/** Propiedades intrínsecas — delegadas al catálogo canónico de `@soec/autonomia` (no se duplican). */
export function mapearReversibilidad(
  tipo: AccionSocialTipo,
): { reversibilidad: Reversibilidad; financiera: boolean; aumentaGasto: boolean } {
  const m = metaDeAccion(tipo);
  return { reversibilidad: m.reversibilidad, financiera: m.financiera, aumentaGasto: m.aumentaGasto };
}
