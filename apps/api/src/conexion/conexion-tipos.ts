/**
 * apps/api · CONEXIONES COMO DATO · vocabulario.
 *
 * Una CONEXIÓN es la relación operativa entre un negocio y una fuente externa: qué proveedor, qué cuenta,
 * con qué configuración y con qué credencial (por REFERENCIA, nunca por valor). Una CAPACIDAD es lo que el
 * negocio tiene permitido hacer con esas conexiones. Ambas son filas, no código: conectar una empresa nueva
 * no exige escribir TypeScript, añadir variables de entorno ni desplegar.
 *
 * FRONTERA DE SECRETOS: en este módulo no entra ningún valor secreto. La configuración de una conexión es
 * pública (endpoint, ruta, allowlist de hosts, identificador de cuenta); el token vive cifrado en el
 * depósito de secretos y aquí sólo aparece su referencia opaca (`secretstore:<org>/<nombre>`, `env:NOMBRE`).
 */
import type { ExperienciaReal, TipoFuente } from '../plataforma/tipos';

/**
 * Proveedores que el modelo admite. Es un vocabulario ABIERTO por diseño: añadir un proveedor es añadir su
 * nombre y su familia, no un módulo por empresa. Los tres primeros son los que esta fase conecta de verdad;
 * el resto están declarados para que una conexión futura no exija migrar el esquema.
 */
export type ProveedorConexion =
  | 'GOOGLE_ADS'
  | 'META_ADS'
  | 'GROWTH_M2M'
  | 'GA4'
  | 'SEARCH_CONSOLE'
  | 'MERCHANT_CENTER'
  | 'WOOCOMMERCE'
  | 'CRM';

export const PROVEEDORES: readonly ProveedorConexion[] = [
  'GOOGLE_ADS', 'META_ADS', 'GROWTH_M2M', 'GA4', 'SEARCH_CONSOLE', 'MERCHANT_CENTER', 'WOOCOMMERCE', 'CRM',
];

/**
 * Estado REAL de la conexión. `NOT_CONNECTED` y `ERROR` significan cosas distintas y ninguno significa
 * «cero datos»: una conexión en error tuvo credencial y dejó de funcionar; una no conectada nunca la tuvo.
 * `DISABLED` es una decisión humana: el dueño la apagó y el runtime debe respetarla.
 */
export type EstadoConexion = 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISABLED';

/** Único estado con el que el runtime lee datos reales de la conexión. */
export const ESTADOS_OPERATIVOS: readonly EstadoConexion[] = ['CONNECTED'];

/**
 * CAPACIDADES OPERATIVAS del negocio. Sustituyen a `experienciasHabilitadas` (un array dentro de un módulo
 * TypeScript) por filas que una persona puede encender y apagar. Las cuatro primeras son las experiencias
 * REALES históricas; las tres últimas gobiernan qué bucles de fondo consideran al negocio.
 *
 * `MONITOR_SEGURIDAD` habilita que el monitor de stop-loss OBSERVE al negocio. No autoriza la pausa: eso lo
 * decide `business_governance.automatic_safety_pause`, que es gobierno y sigue siendo una decisión aparte.
 */
export type CapacidadNegocio =
  | 'MEDICION_REAL'
  | 'DIRECTOR_REAL'
  | 'AUTONOMIA_ADS'
  | 'PILOTO_DECISION'
  | 'INGESTA_GROWTH'
  | 'MONITOR_SEGURIDAD'
  | 'CICLO_DIRECTOR';

export const CAPACIDADES: readonly CapacidadNegocio[] = [
  'MEDICION_REAL', 'DIRECTOR_REAL', 'AUTONOMIA_ADS', 'PILOTO_DECISION',
  'INGESTA_GROWTH', 'MONITOR_SEGURIDAD', 'CICLO_DIRECTOR',
];

/** Traducción exacta entre las experiencias REALES históricas y las capacidades persistidas. */
export const CAPACIDAD_DE_EXPERIENCIA: Readonly<Record<ExperienciaReal, CapacidadNegocio>> = {
  'medicion-real': 'MEDICION_REAL',
  'director-real': 'DIRECTOR_REAL',
  'autonomia-ads': 'AUTONOMIA_ADS',
  'piloto-decision': 'PILOTO_DECISION',
};

export const EXPERIENCIA_DE_CAPACIDAD: Readonly<Partial<Record<CapacidadNegocio, ExperienciaReal>>> = {
  MEDICION_REAL: 'medicion-real',
  DIRECTOR_REAL: 'director-real',
  AUTONOMIA_ADS: 'autonomia-ads',
  PILOTO_DECISION: 'piloto-decision',
};

/**
 * Qué conexión EXIGE cada capacidad para operar. Sirve para decir la verdad cuando algo no corre: «la
 * capacidad está habilitada pero falta la conexión» es una respuesta distinta de «no está habilitada».
 * `null` ⇒ la capacidad no depende de ninguna conexión concreta.
 */
export const CONEXION_REQUERIDA: Readonly<Record<CapacidadNegocio, ProveedorConexion | null>> = {
  MEDICION_REAL: null,
  DIRECTOR_REAL: null,
  AUTONOMIA_ADS: 'GOOGLE_ADS',
  PILOTO_DECISION: null,
  INGESTA_GROWTH: 'GROWTH_M2M',
  MONITOR_SEGURIDAD: 'GOOGLE_ADS',
  CICLO_DIRECTOR: null,
};

/** Familia de fuente de cada proveedor: es lo que el resto de la plataforma ya entiende (`TipoFuente`). */
export const FAMILIA_DE_PROVEEDOR: Readonly<Record<ProveedorConexion, TipoFuente>> = {
  GOOGLE_ADS: 'ADS',
  META_ADS: 'ADS',
  GROWTH_M2M: 'GROWTH',
  GA4: 'ANALYTICS',
  SEARCH_CONSOLE: 'ANALYTICS',
  MERCHANT_CENTER: 'MERCHANT',
  WOOCOMMERCE: 'ECOMMERCE',
  CRM: 'CRM',
};

export function esProveedor(v: unknown): v is ProveedorConexion {
  return typeof v === 'string' && (PROVEEDORES as readonly string[]).includes(v);
}

export function esCapacidad(v: unknown): v is CapacidadNegocio {
  return typeof v === 'string' && (CAPACIDADES as readonly string[]).includes(v);
}

/** Configuración pública de una conexión GROWTH (puente M2M). Sin secretos: sólo el nombre de la credencial. */
export interface ConfigGrowth {
  /** Nombre del proveedor en el vocabulario de fuentes (`cp-odontologia-growth`). Identifica los cursores. */
  readonly provider: string;
  readonly baseUrl: string;
  /** Allowlist CERRADA de hosts (default-deny). Vacía ⇒ no se autoriza ningún host. Nunca comodines. */
  readonly hostsAutorizados: readonly string[];
  readonly rutaIngesta: string;
  readonly nombreLogicoCredencial: string;
  readonly baseUrlEnvOverride?: string | null;
  readonly sourceId?: string;
}

/** Configuración pública de una conexión de Google Ads: identificadores de cuenta y campaña gobernada. */
export interface ConfigGoogleAds {
  readonly customerId: string;
  readonly loginCustomerId: string;
  readonly campaignId: string;
  readonly campaniaRef: string;
  readonly actividadId: string;
  readonly canal: string;
  readonly nombreCampania: string;
  readonly sourceId?: string;
}

export class ConexionInvalidaError extends Error {}

function texto(v: unknown, campo: string, max = 300): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length === 0) throw new ConexionInvalidaError(`${campo} es obligatorio`);
  if (s.length > max) throw new ConexionInvalidaError(`${campo} excede ${max} caracteres`);
  return s;
}

/** Host de una URL https. El puente M2M viaja con un token: exigir https no es cosmético. */
function hostDe(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ConexionInvalidaError('endpoint inválido');
  }
  if (u.protocol !== 'https:') throw new ConexionInvalidaError('el endpoint debe ser https');
  if (!u.hostname.includes('.')) throw new ConexionInvalidaError('endpoint inválido: falta el dominio');
  return u.host;
}

/**
 * Valida y normaliza la configuración de una conexión GROWTH. La allowlist de hosts se DERIVA del endpoint
 * más los hosts adicionales que declare el usuario: nunca queda vacía por descuido ni admite comodines.
 */
export function normalizarConfigGrowth(entrada: Record<string, unknown>): ConfigGrowth {
  const baseUrl = texto(entrada.baseUrl, 'endpoint').replace(/\/+$/, '');
  const host = hostDe(baseUrl);
  const ruta = texto(entrada.rutaIngesta ?? '/integrations/soec/growth-events', 'ruta de ingesta');
  if (!ruta.startsWith('/')) throw new ConexionInvalidaError('la ruta de ingesta debe empezar por "/"');
  const provider = texto(entrada.provider, 'identificador de la fuente', 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new ConexionInvalidaError('el identificador de la fuente admite minúsculas, números y guiones');
  }
  const extra = Array.isArray(entrada.hostsAutorizados)
    ? entrada.hostsAutorizados.map((h) => String(h).trim()).filter((h) => h.length > 0)
    : [];
  for (const h of extra) {
    if (h.includes('*') || h.includes('/')) throw new ConexionInvalidaError(`host no admitido: ${h}`);
  }
  const nombreCred = typeof entrada.nombreLogicoCredencial === 'string' && entrada.nombreLogicoCredencial.trim().length > 0
    ? entrada.nombreLogicoCredencial.trim()
    : `${provider}-token`;
  const override = typeof entrada.baseUrlEnvOverride === 'string' && entrada.baseUrlEnvOverride.trim().length > 0
    ? entrada.baseUrlEnvOverride.trim()
    : null;
  const sourceId = typeof entrada.sourceId === 'string' && entrada.sourceId.trim().length > 0
    ? entrada.sourceId.trim()
    : `src-${provider}`;
  return {
    provider,
    baseUrl,
    hostsAutorizados: [...new Set([host, ...extra])],
    rutaIngesta: ruta,
    nombreLogicoCredencial: nombreCred,
    baseUrlEnvOverride: override,
    sourceId,
  };
}

/** Valida la configuración de Google Ads. Los identificadores son numéricos: un texto libre no es una cuenta. */
export function normalizarConfigGoogleAds(entrada: Record<string, unknown>): ConfigGoogleAds {
  const num = (v: unknown, campo: string): string => {
    const s = texto(v, campo, 32).replace(/[-\s]/g, '');
    if (!/^\d+$/.test(s)) throw new ConexionInvalidaError(`${campo} debe ser numérico`);
    return s;
  };
  return {
    customerId: num(entrada.customerId, 'customer id'),
    loginCustomerId: num(entrada.loginCustomerId ?? entrada.customerId, 'login customer id'),
    campaignId: num(entrada.campaignId, 'campaign id'),
    campaniaRef: texto(entrada.campaniaRef, 'referencia de campaña', 120),
    actividadId: texto(entrada.actividadId, 'actividad', 120),
    canal: texto(entrada.canal ?? 'GOOGLE_SEARCH', 'canal', 40),
    nombreCampania: texto(entrada.nombreCampania, 'nombre de campaña', 200),
    sourceId: typeof entrada.sourceId === 'string' && entrada.sourceId.trim().length > 0 ? entrada.sourceId.trim() : 'src-google-ads',
  };
}
