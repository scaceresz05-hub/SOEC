/**
 * apps/api · V2 PRE-REAL · WRITE CAPABILITY CONTRACT. Cada operación de escritura declara sus scopes
 * requeridos, su impacto financiero y si es reversible. Determinista, sin red. El adapter real usa este
 * catálogo para rechazar (fail-closed) cualquier operación cuyos scopes no estén concedidos o que no esté
 * en la whitelist. NO existen operaciones financieras prohibidas aquí: sólo las ya permitidas.
 */
import type { OperacionMeta } from './meta-write-port';
import { OPERACIONES_META_PERMITIDAS } from './meta-write-port';

export interface CapacidadEscritura {
  readonly requiredScopes: readonly string[];
  readonly financialImpact: boolean; // crea/impacta estructura de gasto
  readonly reversible: boolean; // se puede pausar/eliminar después
}

/** Scopes de Meta necesarios por operación (fuente de verdad para el gate de scopes del adapter real). */
export const CAPACIDADES_ESCRITURA: Readonly<Record<OperacionMeta, CapacidadEscritura>> = {
  CREATE_CAMPAIGN: { requiredScopes: ['ads_management'], financialImpact: true, reversible: true },
  CREATE_ADSET: { requiredScopes: ['ads_management'], financialImpact: true, reversible: true },
  CREATE_AD: { requiredScopes: ['ads_management'], financialImpact: true, reversible: true },
  UPLOAD_CREATIVE: { requiredScopes: ['ads_management'], financialImpact: false, reversible: true },
  PAUSE_CAMPAIGN: { requiredScopes: ['ads_management'], financialImpact: false, reversible: true },
  RESUME_CAMPAIGN: { requiredScopes: ['ads_management'], financialImpact: false, reversible: true },
  PAUSE_AD: { requiredScopes: ['ads_management'], financialImpact: false, reversible: true },
  RESUME_AD: { requiredScopes: ['ads_management'], financialImpact: false, reversible: true },
  PUBLISH_FACEBOOK: { requiredScopes: ['pages_manage_posts'], financialImpact: false, reversible: true },
  PUBLISH_INSTAGRAM: { requiredScopes: ['instagram_content_publish', 'pages_read_engagement'], financialImpact: false, reversible: true },
};

export function capacidadDe(op: OperacionMeta): CapacidadEscritura {
  return CAPACIDADES_ESCRITURA[op];
}

/** Scopes de escritura que exige TODO el path real (unión). Útil para el gate de configuración. */
export const SCOPES_ESCRITURA_REQUERIDOS: readonly string[] = Array.from(
  new Set(OPERACIONES_META_PERMITIDAS.flatMap((op) => CAPACIDADES_ESCRITURA[op].requiredScopes)),
);

/** ¿El set de scopes concedidos cubre los que exige la operación? */
export function scopesSuficientes(op: OperacionMeta, concedidos: readonly string[]): boolean {
  return CAPACIDADES_ESCRITURA[op].requiredScopes.every((s) => concedidos.includes(s));
}
