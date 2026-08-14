/**
 * apps/api · PLATAFORMA MULTIEMPRESA · REGISTRO DE NEGOCIOS, PERFILES Y FUENTES.
 *
 * Punto ÚNICO de resolución `organización → negocio / perfil / fuentes`. Reglas duras:
 *
 *  1. La resolución es por CLAVE DE TENANT EXACTA. No hay coincidencia parcial, ni alias implícito,
 *     ni "organización por defecto".
 *  2. Si una organización no está registrada, se LANZA. Jamás se devuelve la configuración de otra.
 *     No existe `if (!orgConfig) useSmileFlowConfig()` en ninguna forma.
 *  3. El registro no guarda secretos: sólo identidad, configuración y referencias opacas.
 *
 * Añadir una organización = añadir su módulo en `negocios/` y registrarlo aquí. El núcleo no cambia.
 */
import {
  BusinessProfileNoConfiguradoError,
  OrganizacionNoRegistradaError,
  SinFuenteDeDatosError,
} from './errors';
import { assertTenantIdCanonico } from './identidad-organizacion';
import { CONFIGURACION_ORG_SMILEFLOW } from './negocios/org-smileflow';
import type {
  BusinessEvaluationProfile,
  ConfiguracionOrganizacion,
  FuenteRegistrada,
  NegocioRegistrado,
} from './tipos';

/**
 * Registro de organizaciones. Hoy: SmileFlow. Distribuidora C Y P SpA se añadirá como una entrada
 * más, sin modificar este archivo salvo por su alta.
 */
const REGISTRO: ReadonlyMap<string, ConfiguracionOrganizacion> = new Map([
  [CONFIGURACION_ORG_SMILEFLOW.negocio.organizationId, CONFIGURACION_ORG_SMILEFLOW],
]);

/** Organizaciones registradas (para diagnósticos y UI honesta). */
export function organizacionesRegistradas(): readonly string[] {
  return [...REGISTRO.keys()];
}

/** Resolución cruda. `null` si la organización no está registrada. Nunca cae en otra. */
export function buscarConfiguracion(org: string): ConfiguracionOrganizacion | null {
  if (!org) return null;
  return REGISTRO.get(org) ?? null;
}

export function buscarNegocio(org: string): NegocioRegistrado | null {
  return buscarConfiguracion(org)?.negocio ?? null;
}

export function buscarProfile(org: string): BusinessEvaluationProfile | null {
  return buscarConfiguracion(org)?.perfil ?? null;
}

export function buscarFuentes(org: string): readonly FuenteRegistrada[] {
  return buscarConfiguracion(org)?.fuentes ?? [];
}

export function buscarFuente(org: string, provider: string): FuenteRegistrada | null {
  return buscarFuentes(org).find((f) => f.provider === provider) ?? null;
}

/** Negocio de la organización. Lanza `ORGANIZATION_NOT_CONFIGURED` si no está registrada. */
export function getBusiness(org: string): NegocioRegistrado {
  const clave = assertTenantIdCanonico(org);
  const negocio = buscarNegocio(clave);
  if (!negocio) throw new OrganizacionNoRegistradaError(clave);
  // Invariante estructural: la configuración no puede pertenecer a otra organización.
  if (negocio.organizationId !== clave) throw new OrganizacionNoRegistradaError(clave);
  return negocio;
}

/** Perfil de evaluación. Lanza `BUSINESS_PROFILE_NOT_CONFIGURED` si la organización aún no lo tiene. */
export function getProfile(org: string): BusinessEvaluationProfile {
  const negocio = getBusiness(org);
  const perfil = buscarProfile(negocio.organizationId);
  if (!perfil) throw new BusinessProfileNoConfiguradoError(negocio.organizationId);
  if (perfil.organizationId !== negocio.organizationId) {
    throw new BusinessProfileNoConfiguradoError(negocio.organizationId);
  }
  return perfil;
}

/**
 * Fuentes de datos. Lanza `NO_DATA_SOURCE_CONFIGURED` si la organización no tiene ninguna.
 * "Sin fuente" NO es "cero eventos": son estados distintos y se reportan distinto.
 */
export function getSources(org: string): readonly FuenteRegistrada[] {
  const negocio = getBusiness(org);
  const fuentes = buscarFuentes(negocio.organizationId);
  if (fuentes.length === 0) throw new SinFuenteDeDatosError(negocio.organizationId);
  for (const f of fuentes) {
    if (f.organizationId !== negocio.organizationId) {
      throw new SinFuenteDeDatosError(
        negocio.organizationId,
        `fuente ${f.sourceId} de otro tenant`,
      );
    }
  }
  return fuentes;
}

/**
 * Recurso de Google Ads gobernado por la organización. Lanza si la organización no tiene cuenta
 * de Ads registrada: ninguna organización puede resolver la cuenta de otra.
 */
export function getRecursoGoogleAds(
  org: string,
): NonNullable<BusinessEvaluationProfile['externalResourceRefs']['googleAds']> {
  const perfil = getProfile(org);
  const ads = perfil.externalResourceRefs.googleAds;
  if (!ads)
    throw new SinFuenteDeDatosError(perfil.organizationId, 'sin cuenta de Google Ads registrada');
  return ads;
}
