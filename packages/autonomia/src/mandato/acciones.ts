/**
 * @soec/autonomia · mandato · CATÁLOGO GENÉRICO DE ACCIONES.
 *
 * Clasifica cada tipo de acción por sus propiedades intrínsecas: si es reversible, si mueve dinero,
 * si sube el gasto y si exige un plan de reversión. NO codifica Google Ads: es un catálogo de
 * acciones de marketing que cualquier adaptador (Ads, futuro Meta, etc.) puede poblar. La
 * clasificación por-mandato (permitida / requiere aprobación / prohibida) vive en el mandato, no aquí.
 */

export type TipoAccion =
  | 'SEARCH_TERM_EXCLUDE'
  | 'SEARCH_TERM_RESTORE'
  | 'KEYWORD_PAUSE'
  | 'KEYWORD_ENABLE'
  | 'BID_ADJUST'
  | 'BUDGET_REALLOCATE'
  | 'AD_PAUSE'
  | 'AD_ENABLE'
  | 'AD_COPY_EXPERIMENT'
  | 'CAMPAIGN_PAUSE'
  | 'CAMPAIGN_ENABLE'
  | 'CAMPAIGN_CREATE'
  | 'BUDGET_TOTAL_INCREASE'
  // Social orgánico (lectura + escritura). Poblado por el adaptador Meta/otros; ver @soec/adquisicion.
  | 'SOCIAL_INSIGHTS_READ'
  | 'SOCIAL_POST_CREATE_DRAFT'
  | 'SOCIAL_POST_SCHEDULE'
  | 'SOCIAL_POST_PUBLISH'
  // Social pagado (escritura).
  | 'PAID_CAMPAIGN_CREATE'
  | 'PAID_CAMPAIGN_PAUSE'
  | 'PAID_CAMPAIGN_RESUME'
  | 'PAID_AD_CREATE'
  | 'PAID_AD_PAUSE'
  | 'PAID_BUDGET_ADJUST';

/** Cuán reversible es una acción. LEVEL_3 privilegia REVERSIBLE; lo irreversible exige aprobación. */
export type Reversibilidad = 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';

export interface MetaAccion {
  readonly tipo: TipoAccion;
  readonly reversibilidad: Reversibilidad;
  /** Mueve dinero (afecta gasto). Activa el guardarraíl financiero. */
  readonly financiera: boolean;
  /** SUBE el gasto (no sólo lo mueve/baja). Exige límite de gasto configurado. */
  readonly aumentaGasto: boolean;
  /** Exige un plan de reversión antes de ejecutar (bajo política de rollback). */
  readonly exigeRollback: boolean;
}

export const CATALOGO_ACCIONES: Readonly<Record<TipoAccion, MetaAccion>> = {
  SEARCH_TERM_EXCLUDE: { tipo: 'SEARCH_TERM_EXCLUDE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  SEARCH_TERM_RESTORE: { tipo: 'SEARCH_TERM_RESTORE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: false },
  KEYWORD_PAUSE: { tipo: 'KEYWORD_PAUSE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  KEYWORD_ENABLE: { tipo: 'KEYWORD_ENABLE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: true, exigeRollback: true },
  BID_ADJUST: { tipo: 'BID_ADJUST', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  BUDGET_REALLOCATE: { tipo: 'BUDGET_REALLOCATE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: true, aumentaGasto: false, exigeRollback: true },
  AD_PAUSE: { tipo: 'AD_PAUSE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  AD_ENABLE: { tipo: 'AD_ENABLE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: true, exigeRollback: true },
  AD_COPY_EXPERIMENT: { tipo: 'AD_COPY_EXPERIMENT', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  CAMPAIGN_PAUSE: { tipo: 'CAMPAIGN_PAUSE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  CAMPAIGN_ENABLE: { tipo: 'CAMPAIGN_ENABLE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  CAMPAIGN_CREATE: { tipo: 'CAMPAIGN_CREATE', reversibilidad: 'IRREVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  BUDGET_TOTAL_INCREASE: { tipo: 'BUDGET_TOTAL_INCREASE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  // Social orgánico.
  SOCIAL_INSIGHTS_READ: { tipo: 'SOCIAL_INSIGHTS_READ', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: false },
  SOCIAL_POST_CREATE_DRAFT: { tipo: 'SOCIAL_POST_CREATE_DRAFT', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: false },
  SOCIAL_POST_SCHEDULE: { tipo: 'SOCIAL_POST_SCHEDULE', reversibilidad: 'REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  SOCIAL_POST_PUBLISH: { tipo: 'SOCIAL_POST_PUBLISH', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: false, aumentaGasto: false, exigeRollback: true },
  // Social pagado.
  PAID_CAMPAIGN_CREATE: { tipo: 'PAID_CAMPAIGN_CREATE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  PAID_CAMPAIGN_PAUSE: { tipo: 'PAID_CAMPAIGN_PAUSE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: false, exigeRollback: true },
  PAID_CAMPAIGN_RESUME: { tipo: 'PAID_CAMPAIGN_RESUME', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  PAID_AD_CREATE: { tipo: 'PAID_AD_CREATE', reversibilidad: 'PARTIALLY_REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
  PAID_AD_PAUSE: { tipo: 'PAID_AD_PAUSE', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: false, exigeRollback: true },
  PAID_BUDGET_ADJUST: { tipo: 'PAID_BUDGET_ADJUST', reversibilidad: 'REVERSIBLE', financiera: true, aumentaGasto: true, exigeRollback: true },
};

export function metaDeAccion(tipo: TipoAccion): MetaAccion {
  return CATALOGO_ACCIONES[tipo];
}
