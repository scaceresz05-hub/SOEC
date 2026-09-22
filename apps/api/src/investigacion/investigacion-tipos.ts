/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · vocabulario.
 *
 * PRINCIPIO DE ESTA FASE: **evidencia antes que «IA»**. Ninguna conclusión vale por venir de un motor; vale
 * por lo que la sostiene. Por eso cada dato lleva su CLASE y su PROCEDENCIA, y el texto generado nunca es
 * fuente de verdad: es, como máximo, una lectura de datos que sí lo son.
 *
 *   OBSERVED        lo midió una fuente externa (la API de Google, el propio sitio)
 *   DERIVED         se calculó con reglas reproducibles a partir de lo observado
 *   ASSUMED         es una suposición declarada COMO TAL, nunca presentada como hecho
 *   USER_CONFIRMED  lo afirmó una persona del negocio
 *   UNKNOWN         no se sabe — y decirlo es la respuesta correcta
 *
 * Una consecuencia práctica: «dentista curicó tiene demanda» sólo puede existir si al lado están la fuente, el
 * período, la geografía, el volumen observado y la fecha de observación. Si no, no se afirma.
 */

/** Clase epistémica de un dato. Sin esto, una suposición y una medición se confunden. */
export type ClaseEvidencia = 'OBSERVED' | 'DERIVED' | 'ASSUMED' | 'USER_CONFIRMED' | 'UNKNOWN';

export const CLASES_EVIDENCIA: readonly ClaseEvidencia[] = ['OBSERVED', 'DERIVED', 'ASSUMED', 'USER_CONFIRMED', 'UNKNOWN'];

/**
 * Fuente concreta de un dato. Se nombra el SERVICIO, no el proveedor genérico: «Google Ads» no dice si el
 * número vino del planificador de palabras o de una campaña histórica, y eso cambia lo que significa.
 */
export type FuenteEvidencia =
  | 'GOOGLE_ADS_KEYWORD_DATA'
  | 'GOOGLE_ADS_GEO_TARGETS'
  | 'GOOGLE_ADS_HISTORICAL'
  | 'WEBSITE_AUDIT'
  | 'BUSINESS_DATA'
  | 'EVALUATION_POLICY'
  | 'USER_DECLARATION'
  | 'MARKET_PROVIDER'
  | 'INTERNAL_RULES';

export const FUENTES: readonly FuenteEvidencia[] = [
  'GOOGLE_ADS_KEYWORD_DATA', 'GOOGLE_ADS_GEO_TARGETS', 'GOOGLE_ADS_HISTORICAL', 'WEBSITE_AUDIT',
  'BUSINESS_DATA', 'EVALUATION_POLICY', 'USER_DECLARATION', 'MARKET_PROVIDER', 'INTERNAL_RULES',
];

/** Estado de una corrida de investigación. `PARTIAL` es un resultado legítimo, no un fallo a medias. */
export type EstadoInvestigacion = 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'COMPLETE' | 'FAILED' | 'STALE';

export const ESTADOS_INVESTIGACION: readonly EstadoInvestigacion[] = ['QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETE', 'FAILED', 'STALE'];

/** Disponibilidad de una fuente en una corrida. Se registra siempre, incluso cuando no se pudo usar. */
export type DisponibilidadFuente = 'USED' | 'UNAVAILABLE' | 'FAILED' | 'SKIPPED';

export interface EstadoDeFuente {
  readonly fuente: FuenteEvidencia;
  readonly disponibilidad: DisponibilidadFuente;
  /** Por qué no se usó, en lenguaje comprensible. Vacío cuando sí se usó. */
  readonly motivo: string | null;
  /** Versión o fecha del dato de la fuente, cuando la fuente la declara. */
  readonly versionDatos: string | null;
}

/**
 * INTENCIÓN DE BÚSQUEDA. Se clasifica por lo que la persona quiere hacer, no por las palabras que usa:
 * «precio implante dental» es comercial —alguien evaluando comprar—, no tráfico malo por contener «precio».
 */
export type IntencionBusqueda =
  | 'COMMERCIAL'
  | 'TRANSACTIONAL'
  | 'LOCAL'
  | 'INFORMATIONAL'
  | 'NAVIGATIONAL'
  | 'EMPLOYMENT'
  | 'EDUCATIONAL'
  | 'IRRELEVANT';

export const INTENCIONES: readonly IntencionBusqueda[] = [
  'COMMERCIAL', 'TRANSACTIONAL', 'LOCAL', 'INFORMATIONAL', 'NAVIGATIONAL', 'EMPLOYMENT', 'EDUCATIONAL', 'IRRELEVANT',
];

/** Intenciones que, por sí mismas, justifican pagar por el clic. Las demás exigen más evidencia. */
export const INTENCIONES_DE_PAGO: readonly IntencionBusqueda[] = ['COMMERCIAL', 'TRANSACTIONAL', 'LOCAL'];

/** Cómo se clasificó: sin el método, una clasificación no se puede auditar ni mejorar. */
export type MetodoClasificacion = 'RULES_V1' | 'PROVIDER' | 'USER';

/** Elegibilidad de un término para el plan. `CANDIDATE` no es «activo»: es candidato. */
export type ElegibilidadTermino = 'CANDIDATE' | 'EXCLUDED' | 'NEEDS_REVIEW';

/** Tipos de concordancia que un plan puede proponer. BROAD exige justificación explícita. */
export type TipoConcordancia = 'EXACT' | 'PHRASE' | 'BROAD';

/** Veredicto de un canal. Nunca un número del 1 al 10: un ranking arbitrario no se puede discutir. */
export type VeredictoCanal = 'SUITABLE' | 'POSSIBLE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_SUITABLE' | 'BLOCKED';

export const VEREDICTOS_CANAL: readonly VeredictoCanal[] = ['SUITABLE', 'POSSIBLE', 'INSUFFICIENT_EVIDENCE', 'NOT_SUITABLE', 'BLOCKED'];

/** Canales evaluables. Ampliar la lista es añadir un nombre y su evaluación, no reescribir el motor. */
export type CanalEvaluado = 'GOOGLE_SEARCH' | 'META_PAID' | 'ORGANIC_SEARCH' | 'ORGANIC_SOCIAL';

export const CANALES: readonly CanalEvaluado[] = ['GOOGLE_SEARCH', 'META_PAID', 'ORGANIC_SEARCH', 'ORGANIC_SOCIAL'];

/** Compatibilidad de una landing con la oferta que debería promocionar. */
export type EstadoLanding = 'READY' | 'WEAK' | 'MISSING' | 'BLOCKED';

/** Tipos de hallazgo. Un hallazgo es una frase con evidencia detrás, no una opinión. */
export type TipoHallazgo =
  | 'SEARCH_DEMAND_EXISTS'
  | 'OFFER_HAS_LOW_SEARCH_VOLUME'
  | 'LANDING_MISSING'
  | 'LANDING_WEAK'
  | 'GEO_NOT_TARGETABLE'
  | 'GEO_APPROXIMATION_REQUIRED'
  | 'CLAIM_CONFLICT'
  | 'CONVERSION_PATH_MISSING'
  | 'COMPETITOR_DATA_INSUFFICIENT'
  | 'DATA_INSUFFICIENT';

export const TIPOS_HALLAZGO: readonly TipoHallazgo[] = [
  'SEARCH_DEMAND_EXISTS', 'OFFER_HAS_LOW_SEARCH_VOLUME', 'LANDING_MISSING', 'LANDING_WEAK',
  'GEO_NOT_TARGETABLE', 'GEO_APPROXIMATION_REQUIRED', 'CLAIM_CONFLICT', 'CONVERSION_PATH_MISSING',
  'COMPETITOR_DATA_INSUFFICIENT', 'DATA_INSUFFICIENT',
];

/** Confianza de un hallazgo. Se deriva de la clase de sus evidencias, no del entusiasmo del motor. */
export type Confianza = 'HIGH' | 'MEDIUM' | 'LOW';

/** Área del negocio sobre la que impacta un hallazgo. Sirve para ordenar qué atender primero. */
export type AreaImpacto = 'DEMAND' | 'OFFER' | 'GEOGRAPHY' | 'LANDING' | 'MEASUREMENT' | 'BUDGET' | 'COMPLIANCE';

/** Estado de un plan. `NON_EXECUTABLE` es la situación normal mientras falte algo. */
export type EstadoPlan = 'DRAFT' | 'NON_EXECUTABLE' | 'STALE' | 'SUPERSEDED';

/** Dimensiones de preparación de un plan. Cada una se responde por separado. */
export type DimensionPlan = 'RESEARCH_READY' | 'LANDING_READY' | 'MEASUREMENT_READY' | 'BUDGET_READY' | 'CREATIVE_READY' | 'EXECUTION_READY';

export const DIMENSIONES_PLAN: readonly DimensionPlan[] = [
  'RESEARCH_READY', 'LANDING_READY', 'MEASUREMENT_READY', 'BUDGET_READY', 'CREATIVE_READY', 'EXECUTION_READY',
];

/** Requisitos de creatividades. No se genera nada: se declara qué hará falta. */
export type RequisitoCreativo = 'RSA_REQUIRED' | 'IMAGE_ASSETS_REQUIRED' | 'VIDEO_REQUIRED' | 'EXISTING_ASSETS_SUFFICIENT';

/** Requisitos de medición. Sin conversión verificada, ejecutar no es una opción honesta. */
export type RequisitoConversion = 'CONVERSION_SETUP_REQUIRED' | 'CONVERSION_TRACKING_UNVERIFIED' | 'CONVERSION_READY';

/** Estrategias de puja que el planificador puede PROPONER (nunca ejecutar). */
export type EstrategiaPuja = 'MAXIMIZE_CLICKS_WITH_CPC_CEILING' | 'MAXIMIZE_CONVERSIONS' | 'MANUAL_CPC';

export class InvestigacionInvalidaError extends Error {}

const en = <T extends string>(valores: readonly T[], v: unknown, campo: string): T => {
  if (typeof v === 'string' && (valores as readonly string[]).includes(v)) return v as T;
  throw new InvestigacionInvalidaError(`${campo} inválido: ${String(v)}`);
};

export const exigirCanal = (v: unknown): CanalEvaluado => en(CANALES, v, 'canal');
export const exigirIntencion = (v: unknown): IntencionBusqueda => en(INTENCIONES, v, 'intención');
export const exigirClaseEvidencia = (v: unknown): ClaseEvidencia => en(CLASES_EVIDENCIA, v, 'clase de evidencia');

/** Normaliza un término de búsqueda para comparar y deduplicar: sin tildes, sin dobles espacios, minúsculas. */
export function normalizarTermino(termino: string): string {
  return termino
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Raíz aproximada de una palabra en español, para que el SINGULAR y el PLURAL se reconozcan como lo mismo.
 *
 * No es un lematizador: es la regla mínima que evita un error caro. Las ofertas se declaran en plural
 * («Implantes dentales») y la gente busca en singular («implante dental»); sin esta normalización esas
 * búsquedas —las más valiosas— quedarían «sin relación con ninguna oferta declarada» y fuera del plan.
 */
export function raizDePalabra(palabra: string): string {
  let s = palabra;
  if (s.length > 4 && s.endsWith('s')) s = s.slice(0, -1); // implantes → implante
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1); // implante → implant, dentale → dental
  return s;
}

/** Raíces de las palabras significativas de un texto. Las palabras cortas no discriminan y se descartan. */
export function raicesDeTexto(texto: string, minimo = 4): readonly string[] {
  return normalizarTermino(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length >= minimo)
    .map((p) => raizDePalabra(p));
}

/** Confianza derivada de las clases de evidencia que sostienen un hallazgo. Determinista y explicable. */
export function confianzaDesdeEvidencia(clases: readonly ClaseEvidencia[]): Confianza {
  if (clases.length === 0) return 'LOW';
  if (clases.some((c) => c === 'OBSERVED')) return clases.every((c) => c !== 'ASSUMED') ? 'HIGH' : 'MEDIUM';
  if (clases.some((c) => c === 'USER_CONFIRMED' || c === 'DERIVED')) return 'MEDIUM';
  return 'LOW';
}

/** Frescura por defecto de una investigación: pasado ese tiempo, se considera vieja y se ofrece repetirla. */
export const FRESCURA_HORAS_POR_DEFECTO = 24 * 7;

/** Tope de corridas simultáneas en el despliegue. La investigación también consume cuota y dinero ajeno. */
export const MAX_CORRIDAS_CONCURRENTES = 2;
