/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · puertos de proveedores (arquitectura neutral).
 *
 * El dominio pide EVIDENCIA ESTRUCTURADA, nunca texto libre. Quién la produzca —una API determinista, un
 * motor interno de reglas, un servicio externo o, algún día, un modelo de lenguaje— es una decisión de
 * composición que se puede cambiar sin tocar una sola regla de negocio.
 *
 * POR QUÉ IMPORTA: si el dominio dependiera de un proveedor concreto, cambiar de proveedor sería reescribir el
 * producto, y —peor— una respuesta generada podría colarse como si fuera una medición. Aquí eso es imposible:
 * cada puerto devuelve datos tipados con su fuente y su fecha de observación.
 *
 * `ReasoningProvider` se declara y NO se implementa. Es deliberado: en esta fase todo lo que hace falta se
 * resuelve con APIs reales y reglas reproducibles, y los tests de arquitectura que prohíben SDKs de proveedor
 * siguen en pie. El día que una capacidad EXIJA razonamiento generativo, existirá el contrato para enchufarlo
 * sin volverlo obligatorio ni dejar que su salida pase por evidencia.
 */
import type { ClaseEvidencia, FuenteEvidencia } from './investigacion-tipos';

/** Métricas observadas de un término. `null` significa «la fuente no lo informó», nunca cero. */
export interface MetricasTermino {
  readonly avgMonthlySearches: number | null;
  readonly competition: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  readonly competitionIndex: number | null;
  readonly lowTopOfPageBidMicros: number | null;
  readonly highTopOfPageBidMicros: number | null;
}

export interface IdeaDeTermino {
  readonly termino: string;
  readonly metricas: MetricasTermino;
  /** Semilla que produjo la idea (una oferta del negocio, el sitio). Sirve para relacionarla con la oferta. */
  readonly semilla: string | null;
}

export interface PeticionDemanda {
  /** Semillas en lenguaje del negocio: sus ofertas. Nunca términos inventados por el motor. */
  readonly semillas: readonly string[];
  readonly urlSitio: string | null;
  /** Identificadores de geotarget de la plataforma, cuando se conocen. */
  readonly geoTargetIds: readonly string[];
  readonly idioma: string;
  readonly pais: string;
}

export interface RespuestaDemanda {
  readonly ideas: readonly IdeaDeTermino[];
  readonly fuente: FuenteEvidencia;
  readonly observadoEn: string;
  /** Período de los datos históricos, tal como lo declara la fuente. `null` si no lo declara. */
  readonly periodo: string | null;
}

/** Demanda de búsqueda. Hoy la sirve Google Ads; mañana puede servirla otra fuente sin cambiar el dominio. */
export interface SearchDemandProvider {
  readonly nombre: string;
  readonly fuente: FuenteEvidencia;
  /** `null` ⇒ el proveedor no está disponible para esta organización (y se registra como tal). */
  demanda(p: PeticionDemanda): Promise<RespuestaDemanda | null>;
}

export interface GeoTargetResuelto {
  readonly solicitado: string;
  readonly disponible: boolean;
  readonly targetId: string | null;
  readonly targetTipo: string | null;
  readonly nombreCanonico: string | null;
  /** `true` cuando el territorio pedido sólo se puede alcanzar con una unidad más amplia. */
  readonly aproximacion: boolean;
  /** Riesgo de alcanzar territorio no autorizado por usar una unidad más amplia. */
  readonly riesgoDerrame: 'NONE' | 'LOW' | 'HIGH' | 'UNKNOWN';
}

export interface GeoTargetProvider {
  readonly nombre: string;
  readonly fuente: FuenteEvidencia;
  resolver(nombres: readonly string[], pais: string, idioma: string): Promise<readonly GeoTargetResuelto[] | null>;
}

/** Página observada del PROPIO sitio. No se guarda el cuerpo: sólo lo que sirve para decidir. */
export interface PaginaObservada {
  readonly ruta: string;
  readonly httpStatus: number;
  readonly titulo: string | null;
  readonly metaDescription: string | null;
  readonly h1: readonly string[];
  readonly h2: readonly string[];
  readonly ctas: readonly string[];
  readonly enlacesInternos: number;
  readonly canonical: string | null;
  readonly indexable: boolean;
  readonly tieneDatosEstructurados: boolean;
  /** Vías de contacto detectadas: teléfono, WhatsApp, formulario, correo. */
  readonly viasDeContacto: readonly string[];
}

export interface AuditoriaSitio {
  readonly url: string;
  readonly alcanzable: boolean;
  readonly paginas: readonly PaginaObservada[];
  readonly paginasVisitadas: number;
  readonly paginasOmitidas: number;
  readonly error: string | null;
  readonly observadoEn: string;
}

export interface PresupuestoRastreo {
  readonly maxPaginas: number;
  readonly maxProfundidad: number;
  readonly timeoutMsPorPagina: number;
  readonly maxBytesPorPagina: number;
}

export interface WebsiteResearchProvider {
  readonly nombre: string;
  readonly fuente: FuenteEvidencia;
  auditar(url: string, presupuesto: PresupuestoRastreo): Promise<AuditoriaSitio | null>;
}

export interface CompetidorObservado {
  readonly nombre: string;
  readonly dominio: string;
  readonly evidencia: string;
  readonly metodoDescubrimiento: string;
  readonly observadoEn: string;
}

export interface MarketResearchProvider {
  readonly nombre: string;
  readonly fuente: FuenteEvidencia;
  /** `null` ⇒ no hay fuente confiable; el resultado será `COMPETITOR_DATA_INSUFFICIENT`, que es válido. */
  competidores(p: { readonly semillas: readonly string[]; readonly pais: string; readonly territorio: readonly string[] }): Promise<readonly CompetidorObservado[] | null>;
}

/**
 * RAZONAMIENTO GENERATIVO — contrato declarado, sin implementación ni dependencia.
 *
 * Reglas del contrato, para el día que exista una necesidad demostrada:
 *  · la entrada es evidencia ya recogida, nunca una pregunta abierta sobre el negocio;
 *  · la salida es ESTRUCTURADA y entra al dominio como `ASSUMED` o como lectura de evidencias existentes,
 *    jamás como `OBSERVED`;
 *  · el dominio debe seguir funcionando con este proveedor ausente. Si una capacidad no puede existir sin él,
 *    esa capacidad se declara pendiente en lugar de volverse obligatoria.
 */
export interface ReasoningProvider {
  readonly nombre: string;
  /** Interpreta evidencia YA recogida y devuelve una lectura estructurada, nunca una medición nueva. */
  interpretar<T>(entrada: { readonly evidencias: readonly unknown[]; readonly esquema: string }): Promise<{ readonly salida: T; readonly clase: ClaseEvidencia } | null>;
}

/** Proveedor de demanda AUSENTE: responde `null` y el motor registra `UNAVAILABLE` con su motivo. */
export function demandaNoDisponible(motivo: string): SearchDemandProvider & { readonly motivo: string } {
  return {
    nombre: 'sin-proveedor-de-demanda',
    fuente: 'GOOGLE_ADS_KEYWORD_DATA',
    motivo,
    demanda: async () => null,
  };
}

export function geoNoDisponible(motivo: string): GeoTargetProvider & { readonly motivo: string } {
  return {
    nombre: 'sin-proveedor-de-geografia',
    fuente: 'GOOGLE_ADS_GEO_TARGETS',
    motivo,
    resolver: async () => null,
  };
}

/**
 * Competidores: por defecto NO hay fuente confiable. Devolver `null` es la respuesta honesta; inventar
 * competidores a partir de una búsqueda superficial sería peor que no tener el dato.
 */
export const competidoresSinFuente: MarketResearchProvider = {
  nombre: 'sin-fuente-de-mercado',
  fuente: 'MARKET_PROVIDER',
  competidores: async () => null,
};

/** Presupuesto de rastreo conservador por defecto: el sitio del negocio no es un objetivo de scraping. */
export const PRESUPUESTO_RASTREO_POR_DEFECTO: PresupuestoRastreo = {
  maxPaginas: 12,
  maxProfundidad: 2,
  timeoutMsPorPagina: 5_000,
  maxBytesPorPagina: 512 * 1024,
};
