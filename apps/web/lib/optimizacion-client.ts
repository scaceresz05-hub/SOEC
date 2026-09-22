/**
 * Cliente de OPTIMIZACIÓN (vía BFF autenticado `/api/backend/optimizacion`).
 *
 * La pantalla del director muestra, en lenguaje de negocio: qué está observando SOEC, qué decidió, qué cambió
 * solo, qué espera tu permiso y cómo resultó lo anterior. Nunca una tabla técnica ni un enum.
 */
import { cabecerasOrg } from './org-activa';

export interface Requisito { requisito: string; veredicto: string; motivo: string }

export interface VistaOptimizacion {
  organizationId: string;
  /** Moneda ISO de los importes de la vista (en unidades menores de esa moneda). */
  moneda?: string;
  ciclo: {
    id: string; modo: string; estado: string; motivo: string | null;
    ventana: { desde: string; hasta: string; dias: number };
    resumen: Record<string, number | string>;
    iniciadoEn: string; completadoEn: string | null;
  } | null;
  snapshot: {
    campania: { spend: number | null; impressions: number | null; clicks: number | null; conversions: number | null; cpa: number | null; cpc: number | null; ctr: number | null; estado: string | null; presupuestoDiarioMicros: number | null };
    palabras: { texto: string; clicks: number | null; spend: number | null; conversions: number | null; estado: string | null }[];
    terminos: { termino: string; clicks: number | null; spend: number | null; conversions: number | null }[];
    saludMedicion: string;
    ventana: { desde: string; hasta: string; dias: number };
    observadoEn: string;
  } | null;
  decisiones: {
    id: string; accion: string; objetivo: { tipo: string; id: string | null; nombre: string };
    estadoActual: string; estadoPropuesto: string; efectoEsperado: string; riesgo: string;
    confianza: string; reversible: boolean; motivo: string; impactoMaximoClp: number | null;
  }[];
  pendientes: { id: string; estado: string; nota: string | null; creadoEn: string; decision: VistaOptimizacion['decisiones'][number] | null }[];
  aplicadas: { accion: string; resultado: string; verificacion: string; aplicadoEn: string }[];
  politica: {
    version: number; accionesPermitidas: string[]; maxCambioPresupuestoPct: number; maxCambioCpcPct: number;
    maxCambiosPorDia: number; cooldownHoras: number; horasPermitidas: number[] | null;
    activacionAutonomaPermitida: boolean; actualizadoPor: string | null; actualizadoEn: string;
  };
  modoOperativo: string | null;
  evidencia: { veredicto: string; motivo: string; observado: number | null; minimoExigido: { metrica: string; valor: number; procedencia: string } | null; permiteDecisionesDeConversion: boolean } | null;
  aprendizajes: { accion: string; efectoEsperado: string; resultado: string; evaluadoEn: string | null }[];
  historial: { id: string; estado: string; modo: string; iniciadoEn: string; decisiones: number }[];
  campania: { id: string | null; estado: string | null; puedeActivarse: boolean; faltanParaActivar: string[] } | null;
}

export const ETIQUETA_ACCION: Record<string, string> = {
  PAUSE_CAMPAIGN: 'pausar la campaña',
  PAUSE_AD_GROUP: 'pausar un grupo de anuncios',
  PAUSE_KEYWORD: 'dejar de pujar por una búsqueda',
  ADD_NEGATIVE_KEYWORD: 'excluir una búsqueda que no corresponde',
  ADJUST_DAILY_BUDGET: 'ajustar el presupuesto diario',
  ADJUST_MAX_CPC: 'ajustar el precio máximo por visita',
  ENABLE_CAMPAIGN: 'encender la campaña',
  CREATE_KEYWORD: 'añadir una búsqueda nueva',
  CREATE_AD: 'añadir un anuncio nuevo',
};

export const ETIQUETA_RIESGO: Record<string, string> = {
  SAFETY: 'seguridad · reduce el gasto',
  LOW_RISK: 'riesgo bajo',
  MEDIUM_RISK: 'riesgo medio',
  HIGH_RISK: 'riesgo alto',
  PROHIBITED: 'no permitido',
};

export const ETIQUETA_ESTADO_CICLO: Record<string, string> = {
  QUEUED: 'en espera',
  OBSERVING: 'observando',
  EVALUATING: 'evaluando',
  WAITING_FOR_EVIDENCE: 'esperando más datos',
  DECIDED: 'con decisiones tomadas',
  WAITING_FOR_APPROVAL: 'esperando tu permiso',
  EXECUTING: 'aplicando cambios',
  VERIFIED: 'cambios aplicados y verificados',
  NO_ACTION: 'sin nada que cambiar',
  FAILED: 'no se pudo completar',
};

export const ETIQUETA_MODO_CICLO: Record<string, string> = {
  SHADOW: 'sombra (sólo registra lo que haría)',
  SUPERVISED: 'supervisado (te pide permiso)',
  AUTONOMOUS: 'automático (dentro de tus límites)',
};

export const ETIQUETA_APRENDIZAJE: Record<string, string> = {
  IMPROVED: 'mejoró',
  DEGRADED: 'empeoró',
  INCONCLUSIVE: 'sin diferencia clara',
  NOT_ENOUGH_TIME: 'todavía es pronto para saberlo',
};

export const ETIQUETA_MEDICION: Record<string, string> = {
  HEALTHY: 'sana', DEGRADED: 'degradada', UNKNOWN: 'sin verificar',
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerOptimizacion(org: string): Promise<VistaOptimizacion> {
  return j<VistaOptimizacion>(await fetch('/api/backend/optimizacion', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export async function correrCiclo(org: string, modo?: 'SHADOW'): Promise<VistaOptimizacion> {
  return j<VistaOptimizacion>(await fetch('/api/backend/optimizacion/ciclo', {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
    body: JSON.stringify(modo ? { modo } : {}),
  }));
}

export async function resolverPendiente(org: string, id: string, decision: 'APROBAR' | 'RECHAZAR', nota?: string): Promise<VistaOptimizacion> {
  return j<VistaOptimizacion>(await fetch(`/api/backend/optimizacion/pendientes/${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
    body: JSON.stringify({ decision, ...(nota ? { nota } : {}) }),
  }));
}

export async function guardarLimites(org: string, politica: Partial<VistaOptimizacion['politica']>): Promise<VistaOptimizacion> {
  return j<VistaOptimizacion>(await fetch('/api/backend/optimizacion/politica', {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
    body: JSON.stringify(politica),
  }));
}

export async function encenderCampana(org: string): Promise<VistaOptimizacion> {
  return j<VistaOptimizacion>(await fetch('/api/backend/optimizacion/activar', {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}',
  }));
}

export async function cambiarModoOperativo(org: string, mode: 'PILOT' | 'SUPERVISED_REAL' | 'AUTONOMOUS_REAL'): Promise<void> {
  const res = await fetch(`/api/backend/organizations/${org}/operational-mode`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(c.message ?? 'no se pudo cambiar el modo');
  }
}
