/**
 * Taxonomía de acciones sociales (orgánicas y pagadas) + clases de riesgo, provider-neutral.
 *
 * NO es una segunda autonomía: es el catálogo de acciones y su clasificación de riesgo, diseñado para
 * ENCHUFARSE en el motor existente (`MandatoAutonomia` / gates / ledger / canary de `@soec/autonomia`).
 * `mapearReversibilidad` traduce cada acción al modelo intrínseco (reversibilidad × financiera) que
 * los gates ya enforzan. En ESTE bloque toda acción real está prohibida y sólo se permite SHADOW.
 */

export type ClaseRiesgo = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AccionSocialTipo =
  // Orgánico — lectura
  | 'SOCIAL_INSIGHTS_READ'
  | 'SOCIAL_COMMENT_READ'
  // Orgánico — escritura
  | 'SOCIAL_POST_CREATE_DRAFT'
  | 'SOCIAL_POST_SCHEDULE'
  | 'SOCIAL_POST_PUBLISH'
  | 'SOCIAL_POST_DELETE_IF_SUPPORTED'
  | 'REEL_PUBLISH'
  | 'CAROUSEL_PUBLISH'
  | 'STORY_PUBLISH'
  // Pagado
  | 'PAID_CAMPAIGN_CREATE'
  | 'PAID_CAMPAIGN_PAUSE'
  | 'PAID_CAMPAIGN_RESUME'
  | 'PAID_GROUP_CREATE'
  | 'PAID_GROUP_EDIT'
  | 'PAID_AD_CREATE'
  | 'PAID_AD_PAUSE'
  | 'PAID_BUDGET_ADJUST'
  | 'PAID_AUDIENCE_EDIT'
  | 'PAID_CREATIVE_REPLACE';

export type Reversibilidad = 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';

export interface MetaAccionSocial {
  readonly tipo: AccionSocialTipo;
  readonly naturaleza: 'ORGANIC_READ' | 'ORGANIC_WRITE' | 'PAID_READ' | 'PAID_WRITE';
  readonly reversibilidad: Reversibilidad;
  readonly financiera: boolean;
  readonly aumentaGasto: boolean;
  readonly riesgo: ClaseRiesgo;
}

export const CATALOGO_ACCION_SOCIAL: Record<AccionSocialTipo, MetaAccionSocial> = {
  SOCIAL_INSIGHTS_READ: { tipo: 'SOCIAL_INSIGHTS_READ', naturaleza: 'ORGANIC_READ', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'LOW' },
  SOCIAL_COMMENT_READ: { tipo: 'SOCIAL_COMMENT_READ', naturaleza: 'ORGANIC_READ', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'LOW' },
  SOCIAL_POST_CREATE_DRAFT: { tipo: 'SOCIAL_POST_CREATE_DRAFT', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'LOW' },
  SOCIAL_POST_SCHEDULE: { tipo: 'SOCIAL_POST_SCHEDULE', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'MEDIUM' },
  SOCIAL_POST_PUBLISH: { tipo: 'SOCIAL_POST_PUBLISH', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'MEDIUM' },
  SOCIAL_POST_DELETE_IF_SUPPORTED: { tipo: 'SOCIAL_POST_DELETE_IF_SUPPORTED', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'IRREVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'MEDIUM' },
  REEL_PUBLISH: { tipo: 'REEL_PUBLISH', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'MEDIUM' },
  CAROUSEL_PUBLISH: { tipo: 'CAROUSEL_PUBLISH', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'MEDIUM' },
  STORY_PUBLISH: { tipo: 'STORY_PUBLISH', naturaleza: 'ORGANIC_WRITE', reversibilidad: 'IRREVERSIBLE', financiera: false, aumentaGasto: false, riesgo: 'MEDIUM' },
  PAID_CAMPAIGN_CREATE: { tipo: 'PAID_CAMPAIGN_CREATE', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, riesgo: 'HIGH' },
  PAID_CAMPAIGN_PAUSE: { tipo: 'PAID_CAMPAIGN_PAUSE', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: false, riesgo: 'MEDIUM' },
  PAID_CAMPAIGN_RESUME: { tipo: 'PAID_CAMPAIGN_RESUME', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, riesgo: 'HIGH' },
  PAID_GROUP_CREATE: { tipo: 'PAID_GROUP_CREATE', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, riesgo: 'HIGH' },
  PAID_GROUP_EDIT: { tipo: 'PAID_GROUP_EDIT', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: false, riesgo: 'HIGH' },
  PAID_AD_CREATE: { tipo: 'PAID_AD_CREATE', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, riesgo: 'HIGH' },
  PAID_AD_PAUSE: { tipo: 'PAID_AD_PAUSE', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: false, riesgo: 'MEDIUM' },
  PAID_BUDGET_ADJUST: { tipo: 'PAID_BUDGET_ADJUST', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, riesgo: 'CRITICAL' },
  PAID_AUDIENCE_EDIT: { tipo: 'PAID_AUDIENCE_EDIT', naturaleza: 'PAID_WRITE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: false, riesgo: 'HIGH' },
  PAID_CREATIVE_REPLACE: { tipo: 'PAID_CREATIVE_REPLACE', naturaleza: 'PAID_WRITE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: true, aumentaGasto: false, riesgo: 'HIGH' },
};

export function metaDeAccionSocial(tipo: AccionSocialTipo): MetaAccionSocial {
  return CATALOGO_ACCION_SOCIAL[tipo];
}

export type ModoPermitido = 'FORBIDDEN' | 'ALLOWED';

/**
 * Clasificación inicial de este bloque: TODA acción REAL está prohibida; sólo SHADOW se permite.
 * No hay excepciones — ni siquiera para acciones de sólo lectura, cuya ejecución real llega en el
 * capítulo de onboarding con credenciales.
 */
export function clasificacionInicial(_tipo: AccionSocialTipo): { real: ModoPermitido; shadow: ModoPermitido } {
  return { real: 'FORBIDDEN', shadow: 'ALLOWED' };
}

/** Traduce una acción social al modelo intrínseco que los gates de `@soec/autonomia` ya enforzan. */
export function mapearReversibilidad(
  tipo: AccionSocialTipo,
): { reversibilidad: Reversibilidad; financiera: boolean; aumentaGasto: boolean } {
  const m = CATALOGO_ACCION_SOCIAL[tipo];
  return { reversibilidad: m.reversibilidad, financiera: m.financiera, aumentaGasto: m.aumentaGasto };
}
