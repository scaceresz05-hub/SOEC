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
  EmbudoNoConfiguradoError,
  OrganizacionNoRegistradaError,
  SinFuenteDeDatosError,
} from './errors';
import { assertTenantIdCanonico } from './identidad-organizacion';
import { CONFIGURACION_ORG_SMILEFLOW } from './negocios/org-smileflow';
import { CONFIGURACION_ORG_CYP } from './negocios/org-cyp';
import { CONFIGURACION_ORG_CP_ODONTOLOGIA } from './negocios/org-cp-odontologia';
import { ESTADOS_CON_LECTURA } from './tipos';
import type {
  BusinessEvaluationProfile,
  ConfiguracionOrganizacion,
  EmbudoDeConversion,
  FuenteRegistrada,
  NegocioRegistrado,
  PerfilComercial,
  RecursoGoogleAds,
} from './tipos';

/**
 * Descriptor RESUELTO de la fuente `GROWTH` de UNA organización: todo lo que la capa de composición
 * necesita para construir su adaptador de ingesta, y NADA más. El provider, el origen, la allowlist
 * de hosts, la ruta y la referencia de credencial salen de la FUENTE REGISTRADA, nunca del código
 * del adaptador. Sin secretos: `credencialRef` es una referencia opaca.
 */
export interface DescriptorFuenteGrowth {
  readonly organizationId: string;
  readonly sourceId: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly hostsAutorizados: readonly string[];
  readonly rutaIngesta: string;
  readonly credencialRef: string;
  /** Variable de entorno que puede sustituir `baseUrl` en despliegues operativos. La declara la fuente. */
  readonly baseUrlEnvOverride: string | null;
  readonly estado: FuenteRegistrada['estado'];
}

/** Organizaciones registradas en ESTE despliegue. Añadir una es añadir su módulo y esta línea. */
export const ORGANIZACIONES_DEL_DESPLIEGUE: readonly ConfiguracionOrganizacion[] = [
  CONFIGURACION_ORG_SMILEFLOW,
  CONFIGURACION_ORG_CYP,
  CONFIGURACION_ORG_CP_ODONTOLOGIA,
];

export interface ResolutorDeNegocios {
  organizacionesRegistradas(): readonly string[];
  buscarConfiguracion(org: string): ConfiguracionOrganizacion | null;
  buscarNegocio(org: string): NegocioRegistrado | null;
  buscarPerfilComercial(org: string): PerfilComercial | null;
  buscarProfile(org: string): BusinessEvaluationProfile | null;
  buscarFuentes(org: string): readonly FuenteRegistrada[];
  buscarFuente(org: string, provider: string): FuenteRegistrada | null;
  buscarFuenteGrowth(org: string): DescriptorFuenteGrowth | null;
  getFuenteGrowth(org: string): DescriptorFuenteGrowth;
  buscarEmbudo(org: string): EmbudoDeConversion | null;
  getEmbudo(org: string): EmbudoDeConversion;
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

  /**
   * Fuente `GROWTH` de la organización, RESUELTA. Reglas duras:
   *   · sólo se consideran fuentes cuyo `organizationId` coincide con el de la organización;
   *   · más de una fuente GROWTH ⇒ se lanza (la ingesta sería ambigua, jamás se elige una "por defecto");
   *   · fuente GROWTH declarada pero SIN lectura (apagada, sin credencial) ⇒ `null`: no hay ingesta, y eso
   *     no es una avería;
   *   · fuente GROWTH CONECTADA pero sin configuración de ingesta, sin la credencial que declara, o con
   *     allowlist de hosts vacía ⇒ se lanza. No hay valores por defecto heredados de ningún proveedor.
   */
  const buscarFuenteGrowth = (org: string): DescriptorFuenteGrowth | null => {
    const config = buscarConfiguracion(org);
    if (!config) return null;
    const propias = config.negocio.organizationId;
    const growth = buscarFuentes(propias).filter(
      (f) => f.tipo === 'GROWTH' && f.organizationId === propias,
    );
    if (growth.length === 0) return null;
    if (growth.length > 1) {
      throw new SinFuenteDeDatosError(
        propias,
        `hay ${growth.length} fuentes GROWTH registradas: la fuente de ingesta es ambigua`,
      );
    }
    const f = growth[0]!;
    // DECLARADA-PERO-NO-CONECTADA no es un error de configuración: es una fuente que existe y de la que hoy
    // no se puede leer (credencial retirada, conexión apagada por su dueño). Se responde `null` —no hay
    // ingesta— en lugar de lanzar. Lanzar aquí convertía «el dueño apagó su conexión» en una avería que
    // abortaba el tick de ingesta de TODAS las empresas.
    if (!ESTADOS_CON_LECTURA.includes(f.estado)) return null;
    const g = f.growth ?? null;
    if (!g) {
      throw new SinFuenteDeDatosError(
        propias,
        `la fuente GROWTH '${f.sourceId}' no declara configuración de ingesta`,
      );
    }
    if (g.hostsAutorizados.length === 0) {
      throw new SinFuenteDeDatosError(
        propias,
        `la fuente GROWTH '${f.sourceId}' no autoriza ningún host (egress default-deny)`,
      );
    }
    const cred = f.credenciales.find((c) => c.nombreLogico === g.nombreLogicoCredencial) ?? null;
    if (!cred) {
      throw new SinFuenteDeDatosError(
        propias,
        `la fuente GROWTH '${f.sourceId}' no declara la credencial '${g.nombreLogicoCredencial}'`,
      );
    }
    return {
      organizationId: propias,
      sourceId: f.sourceId,
      provider: f.provider,
      baseUrl: g.baseUrl,
      hostsAutorizados: [...g.hostsAutorizados],
      rutaIngesta: g.rutaIngesta,
      credencialRef: cred.secretRef,
      baseUrlEnvOverride: g.baseUrlEnvOverride ?? null,
      estado: f.estado,
    };
  };

  const getFuenteGrowth = (org: string): DescriptorFuenteGrowth => {
    const negocio = getBusiness(org); // lanza si la organización no está registrada
    const d = buscarFuenteGrowth(negocio.organizationId);
    if (!d) throw new SinFuenteDeDatosError(negocio.organizationId, 'sin fuente GROWTH registrada');
    return d;
  };

  /**
   * Embudo de conversión de la organización: el declarado, o —si no declara uno— el que se deriva de
   * su propio `directorContext`. Nunca el de otra organización.
   */
  const buscarEmbudo = (org: string): EmbudoDeConversion | null => {
    const config = buscarConfiguracion(org);
    if (!config) return null;
    if (config.embudo) return config.embudo;
    const dc = config.perfil?.directorContext ?? null;
    if (!dc) return null;
    return {
      conversionPrimaria: dc.conversionPrimaria,
      conversionesSecundarias: dc.conversionesSecundarias,
    };
  };

  const getEmbudo = (org: string): EmbudoDeConversion => {
    const negocio = getBusiness(org); // lanza si la organización no está registrada
    const embudo = buscarEmbudo(negocio.organizationId);
    if (!embudo) throw new EmbudoNoConfiguradoError(negocio.organizationId);
    return embudo;
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
    buscarFuenteGrowth,
    getFuenteGrowth,
    buscarEmbudo,
    getEmbudo,
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

/**
 * ── FUENTE DEL RESOLUTOR (Autonomy Fase B: conexiones como dato) ─────────────────────────────────────────
 *
 * El resolutor sigue siendo la MISMA función pura; lo que cambia es de dónde salen sus configuraciones. Al
 * arrancar, el despliegue las PROYECTA desde PostgreSQL (perfil + conexiones + capacidades + gobierno) y las
 * fija aquí con `fijarNegociosDelRuntime`. Así las rutas que ya resolvían por esta puerta pasan a leer datos
 * persistidos sin que ninguna de ellas cambie, y una empresa creada desde la interfaz queda resoluble sin
 * desplegar.
 *
 * Mientras no se fije nada (tests unitarios, arranque temprano), la fuente es el registro TypeScript
 * histórico: es el comportamiento anterior, intacto.
 */
export type OrigenDeConfiguracion = 'PERSISTIDA' | 'PERSISTIDA_CON_REGISTRO' | 'REGISTRO';

const ORIGEN_INICIAL = new Map<string, OrigenDeConfiguracion>(
  ORGANIZACIONES_DEL_DESPLIEGUE.map((c) => [c.negocio.organizationId, 'REGISTRO' as OrigenDeConfiguracion]),
);

/**
 * Registro TypeScript histórico, INMUTABLE. Existe aparte del resolutor vigente porque la proyección que
 * alimenta al resolutor necesita leer el registro original: si leyera el resolutor ya fijado, cada refresco
 * se construiría sobre el anterior y la procedencia de cada campo dejaría de ser comprobable.
 */
const REGISTRO_HISTORICO = crearResolutorDeNegocios(ORGANIZACIONES_DEL_DESPLIEGUE);

/** Configuración del módulo TypeScript histórico de una organización. `null` si nunca tuvo módulo. */
export const configuracionHistorica = (org: string): ConfiguracionOrganizacion | null =>
  REGISTRO_HISTORICO.buscarConfiguracion(org);

/** Organizaciones que tienen módulo TypeScript histórico. No incluye las creadas desde la interfaz. */
export const organizacionesHistoricas = (): readonly string[] => REGISTRO_HISTORICO.organizacionesRegistradas();

let RESOLUTOR = crearResolutorDeNegocios(ORGANIZACIONES_DEL_DESPLIEGUE);
let ORIGENES: Map<string, OrigenDeConfiguracion> = new Map(ORIGEN_INICIAL);
let CAMPOS_DEL_REGISTRO = new Map<string, readonly string[]>();
let FALTANTES_DE_PERFIL = new Map<string, readonly string[]>();
let FIJADO_EN: string | null = null;
/** Cuántas resoluciones ha servido una configuración que TODAVÍA depende del módulo histórico. */
const USOS_LEGADO = new Map<string, number>();

function anotarUso(org: string): void {
  const origen = ORIGENES.get(org);
  if (origen === undefined || origen === 'PERSISTIDA') return; // una empresa nueva nunca pasa por aquí
  USOS_LEGADO.set(org, (USOS_LEGADO.get(org) ?? 0) + 1);
}

export interface ConfiguracionConProcedencia {
  readonly config: ConfiguracionOrganizacion;
  readonly origen: OrigenDeConfiguracion;
  /** Campos que esta configuración sigue tomando del módulo TypeScript. Vacío ⇒ enteramente dato. */
  readonly camposDelRegistro: readonly string[];
  /**
   * Qué le falta a la POLÍTICA DE EVALUACIÓN de esta organización (Fase C). Vacío ⇒ es evaluable. Se transporta
   * hasta aquí para que el binding —que es sincrónico— pueda decir exactamente qué falta sin consultar la base.
   */
  readonly faltantesDePerfil?: readonly string[];
}

/**
 * Fija las configuraciones con las que opera el runtime. Determinista y sin efectos: construye un resolutor
 * nuevo sobre lo recibido. Si llega dos veces la misma organización, gana la primera (el llamador ya la
 * deduplica; aquí no se lanza, porque un snapshot mal formado no puede tumbar el servidor).
 */
export function fijarNegociosDelRuntime(
  entradas: readonly ConfiguracionConProcedencia[],
  at: string = new Date().toISOString(),
): { readonly organizaciones: number } {
  const unicas = new Map<string, ConfiguracionConProcedencia>();
  for (const e of entradas) {
    const org = e.config.negocio.organizationId;
    if (!unicas.has(org)) unicas.set(org, e);
  }
  RESOLUTOR = crearResolutorDeNegocios([...unicas.values()].map((e) => e.config));
  ORIGENES = new Map([...unicas.entries()].map(([org, e]) => [org, e.origen]));
  CAMPOS_DEL_REGISTRO = new Map([...unicas.entries()].map(([org, e]) => [org, e.camposDelRegistro]));
  FALTANTES_DE_PERFIL = new Map([...unicas.entries()].map(([org, e]) => [org, e.faltantesDePerfil ?? []]));
  FIJADO_EN = at;
  return { organizaciones: unicas.size };
}

/** Vuelve al registro TypeScript histórico. Para tests: deja el módulo como estaba antes de fijar nada. */
export function restablecerNegociosDelRuntime(): void {
  RESOLUTOR = crearResolutorDeNegocios(ORGANIZACIONES_DEL_DESPLIEGUE);
  ORIGENES = new Map(ORIGEN_INICIAL);
  CAMPOS_DEL_REGISTRO = new Map();
  FALTANTES_DE_PERFIL = new Map();
  FIJADO_EN = null;
  USOS_LEGADO.clear();
}

/**
 * TELEMETRÍA de compatibilidad: qué organizaciones siguen dependiendo del módulo histórico, en qué campos y
 * cuántas veces se ha usado. Sirve para poder afirmar —con números, no con confianza— que una empresa nueva
 * no toca el registro.
 */
export function estadoDeCompatibilidadLegado(): {
  readonly fijadoEn: string | null;
  readonly organizaciones: ReadonlyArray<{
    readonly org: string;
    readonly origen: OrigenDeConfiguracion;
    readonly camposDelRegistro: readonly string[];
    readonly usos: number;
  }>;
} {
  return {
    fijadoEn: FIJADO_EN,
    organizaciones: [...ORIGENES.entries()].map(([org, origen]) => ({
      org,
      origen,
      camposDelRegistro: CAMPOS_DEL_REGISTRO.get(org) ?? (origen === 'REGISTRO' ? ['todo'] : []),
      usos: USOS_LEGADO.get(org) ?? 0,
    })),
  };
}

/**
 * Qué le falta a la política de evaluación de una organización, según el último snapshot. Lista vacía cuando
 * es evaluable o cuando todavía no se ha fijado ningún snapshot (el binding usa entonces su propio motivo).
 */
export const faltantesDePerfilDeEvaluacion = (org: string): readonly string[] => FALTANTES_DE_PERFIL.get(org) ?? [];

/** Procedencia de la configuración con la que se está resolviendo una organización. */
export const origenDeConfiguracion = (org: string): OrigenDeConfiguracion | null => ORIGENES.get(org) ?? null;

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
/** Fuente GROWTH resuelta de la organización. `null` si no declara ninguna. */
export const buscarFuenteGrowth = (org: string): DescriptorFuenteGrowth | null => {
  anotarUso(org);
  return RESOLUTOR.buscarFuenteGrowth(org);
};
/** Fuente GROWTH resuelta. Lanza `NO_DATA_SOURCE_CONFIGURED` si la organización no declara ninguna. */
export const getFuenteGrowth = (org: string): DescriptorFuenteGrowth =>
  RESOLUTOR.getFuenteGrowth(org);
/** Embudo de conversión de la organización. `null` si no lo declara ni lo deriva de su perfil. */
export const buscarEmbudo = (org: string): EmbudoDeConversion | null => RESOLUTOR.buscarEmbudo(org);
/** Embudo de conversión. Lanza `CONVERSION_FUNNEL_NOT_CONFIGURED` si la organización no tiene ninguno. */
export const getEmbudo = (org: string): EmbudoDeConversion => RESOLUTOR.getEmbudo(org);

/** Negocio de la organización. Lanza `ORGANIZATION_NOT_CONFIGURED` si no existe como negocio. */
export const getBusiness = (org: string): NegocioRegistrado => {
  anotarUso(org);
  return RESOLUTOR.getBusiness(org);
};
/** Perfil de evaluación. Lanza `BUSINESS_PROFILE_NOT_CONFIGURED` si la organización aún no lo tiene. */
export const getProfile = (org: string): BusinessEvaluationProfile => {
  anotarUso(org);
  return RESOLUTOR.getProfile(org);
};
/** Perfil de evaluación si existe. `null` ⇒ el negocio existe pero su política aún no está configurada. */
export const perfilDeEvaluacionOpcional = (org: string): BusinessEvaluationProfile | null =>
  RESOLUTOR.buscarProfile(org);
/**
 * Fuentes de datos. Lanza `NO_DATA_SOURCE_CONFIGURED` si la organización no declara ninguna.
 * Declarada-pero-no-conectada NO es lo mismo que inexistente: cada fuente lleva su `estado`.
 */
export const getSources = (org: string): readonly FuenteRegistrada[] => RESOLUTOR.getSources(org);
/** Recurso de Google Ads de la organización. Ninguna organización resuelve la cuenta de otra. */
export const getRecursoGoogleAds = (org: string): RecursoGoogleAds => {
  anotarUso(org);
  return RESOLUTOR.getRecursoGoogleAds(org);
};
