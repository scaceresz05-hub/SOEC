/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · vocabulario.
 *
 * Esta fase materializa un plan en una campaña REAL. Por eso el vocabulario empieza por los límites, no por las
 * capacidades:
 *
 *   CREAR ≠ ACTIVAR · PLAN ≠ AUTORIZACIÓN · PROPUESTA DE PRESUPUESTO ≠ MANDATO DE GASTO
 *
 * Toda campaña que SOEC cree nace `PAUSED` y con gasto externo cero. Activarla es otra decisión, de otra fase,
 * de una persona. Nada de lo que hay aquí puede encender una campaña.
 */

/** Estado de una petición de ejecución. `CREATED_PAUSED` es el final feliz: existe y NO gasta. */
export type EstadoEjecucion =
  | 'DRAFT'          // se preparó el paquete; falta comprobar requisitos o autorizar
  | 'BLOCKED'        // un requisito obligatorio no se cumple; no se intenta crear nada
  | 'READY'          // requisitos y autorización en regla; se puede ejecutar
  | 'EXECUTING'      // hay escrituras externas en curso
  | 'PARTIAL'        // se creó una parte; hay checkpoint para reanudar sin duplicar
  | 'CREATED_PAUSED' // campaña creada y verificada en la plataforma, en pausa
  | 'FAILED'         // no se creó nada utilizable; el motivo queda registrado
  | 'CANCELLED';     // la persona la retiró antes de ejecutar

export const ESTADOS_TERMINALES: readonly EstadoEjecucion[] = ['CREATED_PAUSED', 'FAILED', 'CANCELLED'];

/** Proveedor externo de la ejecución. Meta se declara para poder decir que hoy no ejecuta. */
export type ProveedorEjecucion = 'GOOGLE_ADS' | 'META_ADS';

/** Los doce requisitos que se comprueban ANTES de tocar nada externo. */
export type Prerrequisito =
  | 'PLAN_CURRENT'
  | 'BUSINESS_READY'
  | 'CONNECTION_VALID'
  | 'ACCOUNT_SELECTED'
  | 'GEO_EXECUTABLE'
  | 'LANDING_READY'
  | 'CONVERSION_READY'
  | 'CREATIVE_READY'
  | 'FINANCIAL_MANDATE_VALID'
  | 'WRITE_CAPABILITY_ENABLED'
  | 'OPERATING_MODE_ALLOWED'
  | 'KILL_SWITCH_ALLOWED';

export const PRERREQUISITOS: readonly Prerrequisito[] = [
  'PLAN_CURRENT', 'BUSINESS_READY', 'CONNECTION_VALID', 'ACCOUNT_SELECTED', 'GEO_EXECUTABLE', 'LANDING_READY',
  'CONVERSION_READY', 'CREATIVE_READY', 'FINANCIAL_MANDATE_VALID', 'WRITE_CAPABILITY_ENABLED',
  'OPERATING_MODE_ALLOWED', 'KILL_SWITCH_ALLOWED',
];

/**
 * `ACTION_REQUIRED` es distinto de `BLOCKED`: lo primero lo resuelve la persona desde SOEC (escribir anuncios,
 * firmar un presupuesto); lo segundo es una puerta de gobierno que no se negocia desde una pantalla.
 */
export type VeredictoPrerrequisito = 'PASS' | 'BLOCKED' | 'ACTION_REQUIRED' | 'NOT_APPLICABLE';

export interface ResultadoPrerrequisito {
  readonly requisito: Prerrequisito;
  readonly veredicto: VeredictoPrerrequisito;
  /** En lenguaje de negocio: qué falta y quién puede resolverlo. */
  readonly motivo: string;
  /** Detalle técnico opcional para la auditoría (nunca secretos). */
  readonly detalle?: Record<string, unknown>;
}

/** Nombre humano de cada requisito para la interfaz. */
export const TITULO_PRERREQUISITO: Readonly<Record<Prerrequisito, string>> = {
  PLAN_CURRENT: 'El plan está vigente',
  BUSINESS_READY: 'La empresa está configurada',
  CONNECTION_VALID: 'La cuenta de publicidad está conectada',
  ACCOUNT_SELECTED: 'Sabemos en qué cuenta crearla',
  GEO_EXECUTABLE: 'El territorio se puede segmentar',
  LANDING_READY: 'Las páginas de destino están listas',
  CONVERSION_READY: 'La medición de resultados está lista',
  CREATIVE_READY: 'Los anuncios están escritos y aprobados',
  FINANCIAL_MANDATE_VALID: 'Hay una autorización de presupuesto firmada',
  WRITE_CAPABILITY_ENABLED: 'SOEC tiene permiso para crear en tu cuenta',
  OPERATING_MODE_ALLOWED: 'El modo de operación lo permite',
  KILL_SWITCH_ALLOWED: 'El interruptor de seguridad está abierto',
};

/** Pasos del libro de ejecución. Cada uno se registra con su resultado y su identificador externo. */
export type PasoEjecucion =
  | 'CONVERSION_LOOKUP'
  | 'CONVERSION_CREATE'
  | 'BUDGET_CREATE'
  | 'CAMPAIGN_CREATE'
  | 'TARGETING_APPLY'
  | 'AD_GROUP_CREATE'
  | 'KEYWORD_CREATE'
  | 'NEGATIVE_CREATE'
  | 'AD_CREATE'
  | 'ASSET_CREATE'
  | 'VERIFY_REMOTE_STATE';

export type ResultadoPaso = 'OK' | 'SKIPPED_IDEMPOTENT' | 'FAILED';

/**
 * Ciclo de vida de la MEDICIÓN. Son cuatro cosas distintas que el producto solía confundir:
 * la acción existe en la plataforma ≠ el sitio la dispara ≠ alguien lo comprobó.
 */
export type EstadoMedicion =
  | 'ACTION_MISSING'      // no hay acción de conversión en la plataforma
  | 'ACTION_CREATED'      // existe la acción, pero el sitio todavía no la dispara
  | 'TRACKING_MISSING'    // existe la acción y falta instalar la medición
  | 'TRACKING_INSTALLED'  // instalada, sin verificar aún
  | 'VERIFIED'            // observada de verdad al menos una vez
  | 'DEGRADED';           // estuvo verificada y dejó de registrar

/** Sólo `VERIFIED` habilita ejecutar: una acción creada no es medición funcionando. */
export const MEDICION_SUFICIENTE: readonly EstadoMedicion[] = ['VERIFIED'];

export type RolConversion = 'PRIMARY' | 'SECONDARY';

/** Qué representa el valor de una conversión. `SIN_VALOR` es honesto para un contacto sin importe conocido. */
export type SemanticaValor = 'SIN_VALOR' | 'VALOR_FIJO' | 'VALOR_DINAMICO';

/** Tipo comercial de la acción; el ejecutor lo traduce a la configuración técnica de la plataforma. */
export type TipoConversionComercial = 'CONTACTO_WEB' | 'LLAMADA' | 'MENSAJERIA' | 'COMPRA';

export type EstadoVerificacion = 'NO_VERIFICADA' | 'VERIFICADA' | 'FALLIDA';

/** Tipos de material de anuncio que esta fase sabe materializar. */
export type TipoAsset = 'HEADLINE' | 'DESCRIPTION' | 'SITELINK' | 'CALLOUT';

export type EstadoAsset = 'PROPUESTO' | 'APROBADO' | 'RECHAZADO';

/** Mínimos de Google para un anuncio responsive de búsqueda. Menos que esto no se envía. */
export const MINIMO_HEADLINES = 3;
export const MINIMO_DESCRIPCIONES = 2;
export const MAX_LARGO_HEADLINE = 30;
export const MAX_LARGO_DESCRIPCION = 90;

export class EjecucionInvalidaError extends Error {}
export class EjecucionBloqueadaError extends Error {
  constructor(message: string, readonly requisitos: readonly ResultadoPrerrequisito[]) {
    super(message);
  }
}
export class EjecucionNoEncontradaError extends Error {}

/** Divergencia entre lo que SOEC pidió y lo que la plataforma tiene. */
export interface Divergencia {
  readonly campo: string;
  readonly esperado: string;
  readonly encontrado: string;
}

export interface Reconciliacion {
  readonly coincide: boolean;
  readonly divergencias: readonly Divergencia[];
  readonly observadoEn: string;
}

/** Normaliza un texto de anuncio para comparar y validar (sin acentos, minúsculas, espacios simples). */
export function normalizarTexto(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
