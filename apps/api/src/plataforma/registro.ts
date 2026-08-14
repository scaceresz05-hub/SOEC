/**
 * apps/api · PLATAFORMA MULTIEMPRESA · REGISTRO DE NEGOCIOS, PERFILES Y FUENTES.
 *
 * Punto ÚNICO de resolución `organización → negocio / perfil / fuentes`. Reglas duras:
 *
 *  1. La resolución es por CLAVE DE TENANT EXACTA. No hay coincidencia parcial, ni alias implícito,
 *     ni "organización por defecto".
 *  2. Si una organización no está registrada, se LANZA. Jamás se devuelve la configuración de otra.
 *     No existe `if (!orgConfig) useSmileFlowConfig()` en ninguna forma.
 *  3. Una organización SIN perfil (recién incorporada) lanza `BUSINESS_PROFILE_NOT_CONFIGURED`.
 *     Nunca hereda objetivos, criterios ni políticas de nadie.
 *  4. El registro no guarda secretos: sólo identidad, configuración y referencias opacas.
 *
 * EXTENSIBILIDAD (probada): incorporar una organización es AÑADIR SU CONFIGURACIÓN, no modificar el
 * núcleo. `crearResolutorDeNegocios(configs)` construye un resolutor sobre cualquier conjunto de
 * configuraciones; el resolutor por defecto se compone con las organizaciones registradas del
 * despliegue. La prueba de la tercera organización usa exactamente esta puerta.
 */
import {
  BusinessProfileNoConfiguradoError,
  OrganizacionNoRegistradaError,
  SinFuenteDeDatosError,
} from './errors';
import { assertTenantIdCanonico } from './identidad-organizacion';
import { CONFIGURACION_ORG_SMILEFLOW } from './negocios/org-smileflow';
import { CONFIGURACION_ORG_CYP } from './negocios/org-cyp';
import type {
  BusinessEvaluationProfile,
  ConfiguracionOrganizacion,
  FuenteRegistrada,
  NegocioRegistrado,
  PerfilComercial,
  RecursoGoogleAds,
} from './tipos';

/** Organizaciones registradas en ESTE despliegue. Añadir una es añadir su módulo y esta línea. */
export const ORGANIZACIONES_DEL_DESPLIEGUE: readonly ConfiguracionOrganizacion[] = [
  CONFIGURACION_ORG_SMILEFLOW,
  CONFIGURACION_ORG_CYP,
];

export interface ResolutorDeNegocios {
  organizacionesRegistradas(): readonly string[];
  buscarConfiguracion(org: string): ConfiguracionOrganizacion | null;
  buscarNegocio(org: string): NegocioRegistrado | null;
  buscarPerfilComercial(org: string): PerfilComercial | null;
  buscarProfile(org: string): BusinessEvaluationProfile | null;
  buscarFuentes(org: string): readonly FuenteRegistrada[];
  buscarFuente(org: string, provider: string): FuenteRegistrada | null;
  getBusiness(org: string): NegocioRegistrado;
  getProfile(org: string): BusinessEvaluationProfile;
  getSources(org: string): readonly FuenteRegistrada[];
  getRecursoGoogleAds(org: string): RecursoGoogleAds;
}

/**
 * Construye un resolutor sobre un conjunto de configuraciones. PURO: sin estado global, sin
 * dependencia de qué organizaciones existan en el despliegue. Ésta es la puerta de extensión.
 */
export function crearResolutorDeNegocios(
  configs: readonly ConfiguracionOrganizacion[],
): ResolutorDeNegocios {
  const registro = new Map<string, ConfiguracionOrganizacion>();
  for (const c of configs) {
    if (registro.has(c.negocio.organizationId)) {
      throw new Error(`organización duplicada en el registro: ${c.negocio.organizationId}`);
    }
    registro.set(c.negocio.organizationId, c);
  }

  const buscarConfiguracion = (org: string): ConfiguracionOrganizacion | null =>
    org ? (registro.get(org) ?? null) : null;

  const getBusiness = (org: string): NegocioRegistrado => {
    const clave = assertTenantIdCanonico(org);
    const negocio = buscarConfiguracion(clave)?.negocio;
    if (!negocio) throw new OrganizacionNoRegistradaError(clave);
    // Invariante estructural: la configuración no puede pertenecer a otra organización.
    if (negocio.organizationId !== clave) throw new OrganizacionNoRegistradaError(clave);
    return negocio;
  };

  const getProfile = (org: string): BusinessEvaluationProfile => {
    const negocio = getBusiness(org);
    const perfil = buscarConfiguracion(negocio.organizationId)?.perfil ?? null;
    if (!perfil) throw new BusinessProfileNoConfiguradoError(negocio.organizationId);
    if (perfil.organizationId !== negocio.organizationId) {
      throw new BusinessProfileNoConfiguradoError(negocio.organizationId);
    }
    return perfil;
  };

  const buscarFuentes = (org: string): readonly FuenteRegistrada[] =>
    buscarConfiguracion(org)?.fuentes ?? [];

  const getSources = (org: string): readonly FuenteRegistrada[] => {
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
  };

  return {
    organizacionesRegistradas: () => [...registro.keys()],
    buscarConfiguracion,
    buscarNegocio: (org) => buscarConfiguracion(org)?.negocio ?? null,
    buscarPerfilComercial: (org) => buscarConfiguracion(org)?.perfilComercial ?? null,
    buscarProfile: (org) => buscarConfiguracion(org)?.perfil ?? null,
    buscarFuentes,
    buscarFuente: (org, provider) =>
      buscarFuentes(org).find((f) => f.provider === provider) ?? null,
    getBusiness,
    getProfile,
    getSources,
    getRecursoGoogleAds: (org) => {
      const perfil = getProfile(org); // lanza si la organización no tiene perfil
      const ads = perfil.externalResourceRefs.googleAds;
      if (!ads) {
        throw new SinFuenteDeDatosError(
          perfil.organizationId,
          'sin cuenta de Google Ads registrada',
        );
      }
      return ads;
    },
  };
}

/** Resolutor por defecto del despliegue. Las funciones exportadas delegan en él. */
const RESOLUTOR = crearResolutorDeNegocios(ORGANIZACIONES_DEL_DESPLIEGUE);

export const organizacionesRegistradas = (): readonly string[] =>
  RESOLUTOR.organizacionesRegistradas();
export const buscarConfiguracion = (org: string): ConfiguracionOrganizacion | null =>
  RESOLUTOR.buscarConfiguracion(org);
export const buscarNegocio = (org: string): NegocioRegistrado | null =>
  RESOLUTOR.buscarNegocio(org);
/** Qué ES el negocio (hechos del discovery). `null` si aún no se ha caracterizado. */
export const buscarPerfilComercial = (org: string): PerfilComercial | null =>
  RESOLUTOR.buscarPerfilComercial(org);
export const buscarProfile = (org: string): BusinessEvaluationProfile | null =>
  RESOLUTOR.buscarProfile(org);
export const buscarFuentes = (org: string): readonly FuenteRegistrada[] =>
  RESOLUTOR.buscarFuentes(org);
export const buscarFuente = (org: string, provider: string): FuenteRegistrada | null =>
  RESOLUTOR.buscarFuente(org, provider);

/** Negocio de la organización. Lanza `ORGANIZATION_NOT_CONFIGURED` si no está registrada. */
export const getBusiness = (org: string): NegocioRegistrado => RESOLUTOR.getBusiness(org);
/** Perfil de evaluación. Lanza `BUSINESS_PROFILE_NOT_CONFIGURED` si la organización aún no lo tiene. */
export const getProfile = (org: string): BusinessEvaluationProfile => RESOLUTOR.getProfile(org);
/**
 * Fuentes de datos. Lanza `NO_DATA_SOURCE_CONFIGURED` si la organización no declara ninguna.
 * Declarada-pero-no-conectada NO es lo mismo que inexistente: cada fuente lleva su `estado`.
 */
export const getSources = (org: string): readonly FuenteRegistrada[] => RESOLUTOR.getSources(org);
/** Recurso de Google Ads de la organización. Ninguna organización resuelve la cuenta de otra. */
export const getRecursoGoogleAds = (org: string): RecursoGoogleAds =>
  RESOLUTOR.getRecursoGoogleAds(org);
