/**
 * apps/api · PLATAFORMA MULTIEMPRESA · IDENTIDAD CANÓNICA DE ORGANIZACIÓN.
 *
 * SOEC arrastraba TRES identificadores para la misma empresa, usados indistintamente:
 *   `org-smileflow`    → tenant real (streams del event-store, ingesta, Ads, Director)
 *   `smileflow-clinic` → identificador del registro de organización DENTRO del dominio `@soec/piloto`
 *   `smileflow`        → fixture del piloto sintético `@soec/piloto-director-v1`
 *
 * Aquí se separan formalmente TRES conceptos que no son intercambiables:
 *
 *   CANONICAL_ORG_ID — la ÚNICA clave de tenant. Es la que viaja en `RequestContext.organizationId`,
 *                      la que filtra el event-store y la que gobierna el aislamiento.
 *   BUSINESS_KEY     — identificador del NEGOCIO dentro de un dominio (p. ej. el `orgId` del
 *                      expediente de piloto). Nunca es una clave de tenant.
 *   LEGACY_ALIAS     — valor histórico que puede aparecer en datos o URLs antiguas. Se puede
 *                      CANONIZAR de forma explícita y deliberada, pero JAMÁS se acepta como tenant.
 *
 * No hay migración destructiva: los alias siguen existiendo, pero dejan de ser utilizables como
 * identidad de tenant. Si alguien los usa como tal, se lanza.
 */
import { IdentidadOrganizacionInvalidaError } from './errors';

/** Clave de tenant canónica de SmileFlow Clinic. La única válida como `organizationId`. */
export const ORG_SMILEFLOW = 'org-smileflow' as const;

/** Clave de NEGOCIO de SmileFlow dentro del dominio de piloto. No es un tenant id. */
export const BUSINESS_KEY_SMILEFLOW = 'smileflow-clinic' as const;

/** Alias históricos → tenant canónico. Canonizables de forma explícita; nunca implícita. */
const ALIAS_LEGADOS: ReadonlyMap<string, string> = new Map([
  ['smileflow-clinic', ORG_SMILEFLOW],
  ['smileflow', ORG_SMILEFLOW],
]);

/** Formato admisible de una clave de tenant (mismo criterio que `slugValido` de @soec/identity). */
const FORMATO_TENANT = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function esAliasLegado(valor: string): boolean {
  return ALIAS_LEGADOS.has(valor);
}

export function aliasLegados(): readonly string[] {
  return [...ALIAS_LEGADOS.keys()];
}

/**
 * Canoniza un alias legado de forma EXPLÍCITA. Devuelve `null` si el valor no es un alias conocido.
 * Nunca se llama desde el camino de autorización: sólo desde migraciones o enlaces históricos.
 */
export function canonizarAliasLegado(valor: string): string | null {
  return ALIAS_LEGADOS.get(valor) ?? null;
}

/**
 * Exige que un valor sea utilizable como CLAVE DE TENANT. Rechaza vacíos, formatos inválidos y —lo
 * importante— cualquier alias legado: `smileflow-clinic` NO es una organización, es una businessKey.
 */
export function assertTenantIdCanonico(valor: string): string {
  const v = (valor ?? '').trim();
  if (!v) throw new IdentidadOrganizacionInvalidaError(valor ?? '', 'vacío');
  if (!FORMATO_TENANT.test(v)) {
    throw new IdentidadOrganizacionInvalidaError(v, 'formato inválido para una clave de tenant');
  }
  if (ALIAS_LEGADOS.has(v)) {
    throw new IdentidadOrganizacionInvalidaError(
      v,
      `es un alias legado (businessKey), no una clave de tenant; la canónica es '${ALIAS_LEGADOS.get(v)!}'`,
    );
  }
  return v;
}

/** ¿Es una clave de tenant válida? (no lanza) */
export function esTenantIdCanonico(valor: string): boolean {
  try {
    assertTenantIdCanonico(valor);
    return true;
  } catch {
    return false;
  }
}
