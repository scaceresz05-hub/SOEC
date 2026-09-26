/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · composición de proveedores por organización.
 *
 * Aquí se decide, para CADA empresa y en cada corrida, qué fuentes hay realmente disponibles. Dos reglas:
 *
 *  · NO SE DEPENDE DE UNA CAMPAÑA ACTIVA NI DE UN PERMISO DE ESCRITURA. Para investigar basta una cuenta
 *    conectada: el identificador de cliente sale de la conexión persistida (Fase B) o de la propia conexión
 *    OAuth, no de una campaña existente. Una empresa nueva que acaba de conectar Google puede investigar el
 *    primer día.
 *
 *    Hasta esta corrección, las fuentes de Google exigían además `MEDICION_REAL` o `AUTONOMIA_ADS`. Era el
 *    mismo defecto que ya apareció en facturación: una LECTURA gobernada por un permiso de EJECUCIÓN. El
 *    efecto en el mundo real fue que una empresa con su cuenta conectada y sana (CONNECTED, HEALTHY, con
 *    customerId) leía en pantalla «sin conexión de Google» y «falta una conexión de Google Ads con permiso de
 *    lectura» — una frase que además era falsa, porque la conexión existía y el permiso que faltaba no era de
 *    lectura. Consultar el planificador de palabras y los territorios segmentables no cambia nada en la cuenta
 *    de nadie: lo único que hace falta es que la cuenta esté conectada y la credencial sirva.
 *  · FAIL-CLOSED Y EXPLÍCITO. Sin conexión, sin capacidad de lectura o sin configuración de la plataforma, el
 *    proveedor simplemente no se construye: la corrida registrará la fuente como no disponible con su motivo,
 *    en lugar de inventar datos.
 *
 * El coordinador de consultas es COMPARTIDO por proceso: dos empresas investigando a la vez no se pisan, pero
 * dos pantallas de la misma empresa no producen dos llamadas a Google.
 */
import type { Pool } from 'pg';
import { obtenerAccessTokenDeOrg } from '../acquisition/google-ads-oauth-flow';
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { CoordinadorDeConsultas, crearProveedorDemandaGoogle, crearProveedorGeoGoogle } from './google-providers';
import { crearProveedorSitio } from './sitio-auditoria';
import { competidoresSinFuente } from './proveedores';
import type { DepsInvestigacion } from './investigacion-service';
import type { EntradaSondas } from './probe-demanda';

/** Un único coordinador por proceso: es la defensa de cuota, y compartirla es justamente el objetivo. */
export const coordinadorGlobal = new CoordinadorDeConsultas();

export interface OpcionesComposicion {
  readonly pool: Pool;
  readonly env: NodeJS.ProcessEnv;
  readonly composicionGoogleAds: ComponentesFlujoGoogleAds | null | undefined;
  readonly log?: (info: Record<string, unknown>) => void;
}

/**
 * Identificadores de la cuenta de Google Ads de la organización, tomados de lo PERSISTIDO. Primero la conexión
 * del negocio (Fase B); si no declara cuenta, la conexión OAuth. `null` ⇒ no hay cuenta con la que investigar.
 */
async function cuentaDeGoogle(pool: Pool, org: string): Promise<{ customerId: string; loginCustomerId: string } | null> {
  const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS');
  if (conexion !== null && conexion.estado === 'CONNECTED') {
    const cfg = conexion.configuracion as { customerId?: string; loginCustomerId?: string };
    const customerId = (cfg.customerId ?? conexion.externalAccountId ?? '').replace(/\D/g, '');
    if (customerId !== '') {
      const login = (cfg.loginCustomerId ?? conexion.loginAccountId ?? customerId).replace(/\D/g, '');
      return { customerId, loginCustomerId: login === '' ? customerId : login };
    }
  }
  // La cuenta puede estar conectada por OAuth sin que nadie haya declarado todavía campaña ni recurso.
  try {
    const { rows } = await pool.query(
      `select customer_id, login_customer_id from google_ads_connection
       where organization_id = $1 and estado = 'CONNECTED' and customer_id is not null
       order by updated_at desc limit 1`,
      [org],
    );
    const r = rows[0] as { customer_id: string | null; login_customer_id: string | null } | undefined;
    if (r?.customer_id) {
      const customerId = String(r.customer_id).replace(/\D/g, '');
      const login = String(r.login_customer_id ?? r.customer_id).replace(/\D/g, '');
      return { customerId, loginCustomerId: login === '' ? customerId : login };
    }
  } catch {
    // El esquema OAuth puede no existir en un despliegue mínimo: no es un fallo del negocio.
  }
  return null;
}

/**
 * MATERIALES PARA SONDAR EL PLANIFICADOR de una organización: su cliente, su cuenta y los territorios ya
 * resueltos. Devuelve `null` si no hay con qué preguntar — y entonces la ruta lo dice en vez de diagnosticar
 * a ciegas. Resuelve además los ids de país y región CONSULTANDO a la plataforma: no se fijan constantes
 * geográficas en el código, que es justo lo que después nadie sabe si sigue siendo cierto.
 */
export async function sondasDeDemandaDeOrganizacion(
  org: string,
  o: OpcionesComposicion & { readonly perfil: { readonly website: string | null; readonly language: string; readonly country: string }; readonly semillas: readonly string[]; readonly geoComunas: readonly string[]; readonly region: string | null },
): Promise<EntradaSondas | null> {
  const developerToken = o.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!o.composicionGoogleAds || !developerToken) return null;
  const cuenta = await cuentaDeGoogle(o.pool, org);
  if (cuenta === null) return null;

  const cliente = new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(o.composicionGoogleAds!, org),
    developerToken,
    loginCustomerId: cuenta.loginCustomerId,
    ...(o.log ? { logger: (i: unknown) => o.log?.({ googleAdsSondas: i }) } : {}),
  });

  // País y región se PREGUNTAN a la plataforma, igual que las comunas del negocio.
  let geoPaisId: string | null = null;
  let geoRegionId: string | null = null;
  let geoRegionNombre: string | null = null;
  try {
    const nombres = [o.perfil.country === 'CL' ? 'Chile' : o.perfil.country, ...(o.region !== null ? [o.region] : [])];
    const sugeridos = await cliente.sugerirGeoTargets(nombres, o.perfil.country, o.perfil.language);
    const pais = sugeridos.find((g) => g.targetType === 'Country');
    geoPaisId = pais?.criterionId ?? null;
    const region = sugeridos.find((g) => g.targetType === 'Region' || g.targetType === 'Province' || g.targetType === 'State');
    geoRegionId = region?.criterionId ?? null;
    geoRegionNombre = region?.name ?? o.region;
  } catch {
    // Si la resolución geográfica falla, las sondas que no dependen de ella siguen valiendo.
  }

  return {
    cliente,
    customerId: cuenta.customerId,
    semillas: o.semillas,
    urlSitio: o.perfil.website,
    idioma: o.perfil.language,
    pais: o.perfil.country,
    geoComunas: o.geoComunas,
    geoPaisId,
    geoRegionId,
    geoRegionNombre,
  };
}

/**
 * Proveedores disponibles para una organización. La auditoría del propio sitio SIEMPRE está disponible (es
 * HTTP y el sitio es del negocio); las fuentes de Google dependen de que haya cuenta conectada y permiso de
 * lectura.
 */
export async function proveedoresDeOrganizacion(org: string, o: OpcionesComposicion): Promise<DepsInvestigacion> {
  const base: DepsInvestigacion = {
    sitio: crearProveedorSitio({}),
    mercado: competidoresSinFuente,
    ...(o.log ? { log: o.log } : {}),
  };

  const developerToken = o.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  // Sin la plataforma configurada en el despliegue no hay a quién preguntar. Eso es todo lo que se exige
  // además de la conexión del propio negocio: ninguna capacidad, porque ninguna de estas consultas escribe.
  if (!o.composicionGoogleAds || !developerToken) {
    return base;
  }
  const cuenta = await cuentaDeGoogle(o.pool, org);
  if (cuenta === null) return base;

  const cliente = new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(o.composicionGoogleAds!, org),
    developerToken,
    loginCustomerId: cuenta.loginCustomerId,
    ...(o.log ? { logger: (i: unknown) => o.log?.({ googleAdsInvestigacion: i }) } : {}),
  });
  const deps = {
    cliente,
    customerId: cuenta.customerId,
    org,
    coordinador: coordinadorGlobal,
    ...(o.log ? { log: o.log } : {}),
  };
  return {
    ...base,
    demanda: crearProveedorDemandaGoogle(deps),
    geo: crearProveedorGeoGoogle(deps),
  };
}
