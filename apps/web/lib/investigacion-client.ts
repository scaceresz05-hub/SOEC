/**
 * Cliente de INVESTIGACIÓN y PLAN DE MARKETING (vía BFF autenticado `/api/backend/investigacion|plan`).
 *
 * La interfaz muestra evidencia y decisiones en lenguaje de negocio. Nunca GAQL, nunca payloads de la API de
 * Google, nunca identificadores internos sueltos: si algo sólo se entiende leyendo código, no va a la pantalla.
 */
import { cabecerasOrg } from './org-activa';

export type EstadoInvestigacion = 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'COMPLETE' | 'FAILED' | 'STALE';
export type VeredictoCanal = 'SUITABLE' | 'POSSIBLE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_SUITABLE' | 'BLOCKED';
export type EstadoLanding = 'READY' | 'WEAK' | 'MISSING' | 'BLOCKED';

export interface EstadoFuente {
  fuente: string;
  disponibilidad: 'USED' | 'UNAVAILABLE' | 'FAILED' | 'SKIPPED';
  motivo: string | null;
  versionDatos: string | null;
}

export interface VistaInvestigacion {
  organizationId: string;
  corrida: {
    id: string;
    estado: EstadoInvestigacion;
    fuentes: EstadoFuente[];
    fallos: string[];
    iniciadoEn: string;
    completadoEn: string | null;
    motivoStale: string | null;
  } | null;
  evidencias: { id: string; clase: string; fuente: string; statement: string; periodo: string | null; observadoEn: string }[];
  hallazgos: { id: string; tipo: string; statement: string; confianza: string; areaImpacto: string; evidenciaIds: string[] }[];
  terminos: {
    id: string; termino: string; intencion: string; intencionEvidencia: string | null; ofertaSlug: string | null;
    metricas: { avgMonthlySearches?: number | null; competition?: string; lowTopOfPageBidMicros?: number | null; highTopOfPageBidMicros?: number | null };
    elegibilidad: string; motivoExclusion: string | null;
  }[];
  geos: { solicitado: string; disponible: boolean; targetTipo: string | null; aproximacion: boolean; riesgoDerrame: string }[];
  canales: { canal: string; veredicto: VeredictoCanal; motivos: string[] }[];
  landings: { ofertaSlug: string; estado: EstadoLanding; url: string | null; motivos: string[] }[];
  competidores: { nombre: string; dominio: string }[];
  candidatosNegativos: { termino: string; motivo: string; evidencia: string }[];
  frescura: { horas: number; vencida: boolean; observadaEn: string | null };
  puedeInvestigar: { puede: boolean; motivo: string | null };
}

export interface VistaPlan {
  organizationId: string;
  plan: {
    id: string;
    version: number;
    estado: string;
    canal: string;
    objetivo: string;
    ofertas: string[];
    geografia: { targets: { nombre: string; targetId: string | null; tipo: string | null }[]; noEjecutables: string[]; aproximaciones: string[] };
    presupuesto: {
      techoDeclaradoClp: number | null; modalidadTecho: string | null; propuestoDiarioClp: number | null;
      oportunidadDiariaClp: number | null; costoPorClicEstimadoClp: number | null; base: string; explicacion: string;
    };
    puja: { estrategia: string; techoCpcClp: number | null; justificacion: string };
    estructura: { tipo: string; justificacion: string };
    requisitosCreativos: string[];
    requisitoConversion: string;
    prerequisitos: string[];
    readiness: Record<string, boolean>;
    explicacion: { decision: string; porque: string; evidenciaIds: string[] }[];
    creadoEn: string;
    motivoStale: string | null;
  } | null;
  grupos: {
    id: string; nombre: string; ofertaSlug: string; landing: string | null;
    palabras: { termino: string; concordancia: string; justificacion: string; volumenMensual: number | null }[];
    negativas: { termino: string; motivo: string }[];
    justificacion: string;
  }[];
  historial: { id: string; version: number; estado: string; creadoEn: string }[];
  puedeGenerar: { puede: boolean; motivo: string | null };
}

/** Nombres de fuente en lenguaje de negocio. El usuario no tiene que saber qué servicio de Google es cuál. */
export const NOMBRE_FUENTE: Record<string, string> = {
  GOOGLE_ADS_KEYWORD_DATA: 'Demanda de búsqueda en Google',
  GOOGLE_ADS_GEO_TARGETS: 'Territorios disponibles en Google',
  GOOGLE_ADS_HISTORICAL: 'Historial de tu cuenta de Google',
  WEBSITE_AUDIT: 'Tu propio sitio web',
  BUSINESS_DATA: 'Datos de tu empresa',
  EVALUATION_POLICY: 'Tus objetivos y criterios',
  USER_DECLARATION: 'Lo que declaraste',
  MARKET_PROVIDER: 'Fuente de mercado',
  INTERNAL_RULES: 'Reglas internas de SOEC',
};

export const ETIQUETA_DISPONIBILIDAD: Record<string, string> = {
  USED: 'usada',
  UNAVAILABLE: 'no disponible',
  FAILED: 'falló',
  SKIPPED: 'no aplicaba',
};

export const ETIQUETA_VEREDICTO: Record<VeredictoCanal, string> = {
  SUITABLE: 'tiene sentido',
  POSSIBLE: 'posible, con condiciones',
  INSUFFICIENT_EVIDENCE: 'faltan datos para decidir',
  NOT_SUITABLE: 'no tiene sentido hoy',
  BLOCKED: 'bloqueado por tus reglas',
};

export const NOMBRE_CANAL: Record<string, string> = {
  GOOGLE_SEARCH: 'Buscador de Google (pago)',
  META_PAID: 'Facebook e Instagram (pago)',
  ORGANIC_SEARCH: 'Posicionamiento natural en buscadores',
  ORGANIC_SOCIAL: 'Redes sociales sin pagar',
};

export const ETIQUETA_LANDING: Record<EstadoLanding, string> = {
  READY: 'lista',
  WEAK: 'le falta algo',
  MISSING: 'no existe',
  BLOCKED: 'bloqueada',
};

export const ETIQUETA_INTENCION: Record<string, string> = {
  COMMERCIAL: 'está evaluando comprar',
  TRANSACTIONAL: 'quiere contratar ya',
  LOCAL: 'busca cerca',
  INFORMATIONAL: 'busca información',
  NAVIGATIONAL: 'busca un sitio concreto',
  EMPLOYMENT: 'busca trabajo',
  EDUCATIONAL: 'quiere estudiar',
  IRRELEVANT: 'no corresponde a tu negocio',
};

export const ETIQUETA_DIMENSION: Record<string, string> = {
  RESEARCH_READY: 'Investigación suficiente',
  LANDING_READY: 'Páginas de destino listas',
  MEASUREMENT_READY: 'Medición lista',
  BUDGET_READY: 'Presupuesto declarado',
  CREATIVE_READY: 'Anuncios escritos',
  EXECUTION_READY: 'Se podría publicar',
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerInvestigacion(org: string): Promise<VistaInvestigacion> {
  return j<VistaInvestigacion>(await fetch('/api/backend/investigacion', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export async function investigar(org: string, forzar = false): Promise<VistaInvestigacion> {
  return j<VistaInvestigacion>(
    await fetch('/api/backend/investigacion', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: JSON.stringify({ forzar }),
    }),
  );
}

export async function leerPlan(org: string): Promise<VistaPlan> {
  return j<VistaPlan>(await fetch('/api/backend/plan', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export async function generarPlan(org: string): Promise<VistaPlan> {
  return j<VistaPlan>(
    await fetch('/api/backend/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: '{}',
    }),
  );
}
