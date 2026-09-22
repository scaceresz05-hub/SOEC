/**
 * Cliente de EJECUCIÓN DE CAMPAÑAS (vía BFF autenticado `/api/backend/campana/*`).
 *
 * La pantalla muestra en lenguaje de negocio lo que se va a crear y lo que falta. Nunca pide aprobar un JSON,
 * un `resourceName` ni un enum de la API. Y dice, en todas partes, la única frase que importa:
 *
 *   «La campaña se creará pausada y no generará gasto.»
 */
import { cabecerasOrg } from './org-activa';

export type VeredictoRequisito = 'PASS' | 'BLOCKED' | 'ACTION_REQUIRED' | 'NOT_APPLICABLE';
export type EstadoEjecucion = 'DRAFT' | 'BLOCKED' | 'READY' | 'EXECUTING' | 'PARTIAL' | 'CREATED_PAUSED' | 'FAILED' | 'CANCELLED';

export interface Requisito {
  requisito: string;
  veredicto: VeredictoRequisito;
  motivo: string;
}

export interface VistaEjecucion {
  organizationId: string;
  peticion: {
    id: string;
    estado: EstadoEjecucion;
    planVersion: number;
    solicitadoEn: string;
    motivo: string | null;
    autorizacion: { actor: string; autorizadoEn: string; accion: string; mandatoId: string; modoOperativo: string } | null;
    recursosExternos: Record<string, string[]>;
    reconciliacion: { coincide: boolean; divergencias: { campo: string; esperado: string; encontrado: string }[]; observadoEn: string } | null;
  } | null;
  prerrequisitos: Requisito[];
  puedeEjecutar: boolean;
  resumen: {
    cuenta: string;
    campania: string;
    presupuestoDiario: string;
    topeAutorizado: string;
    ubicaciones: string[];
    grupos: { nombre: string; palabras: number; ejemplos: string[]; destino: string; titulares: string[]; descripciones: string[] }[];
    negativas: number;
    conversiones: string[];
    pendientes: string[];
    aviso: string;
  } | null;
  material: { id: string; ofertaSlug: string; tipo: string; texto: string; url: string | null; estado: string }[];
  medicion: { eventKey: string; estado: string; externalId: string | null; instrucciones: { titulo: string; detalle: string; fragmento: string | null }[] }[];
  mandato: { id: string; topeMinor: number; moneda: string; hasta: string; autorizadoPor: string } | null;
  claims: { ok: boolean; conflictos: { donde: string; texto: string; restriccion: string; coincidencia: string }[]; revisados: number } | null;
  historial: { id: string; estado: EstadoEjecucion; solicitadoEn: string; planVersion: number }[];
}

/** Nombre humano de cada requisito. */
export const TITULO_REQUISITO: Record<string, string> = {
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

export const ETIQUETA_ESTADO_EJECUCION: Record<EstadoEjecucion, string> = {
  DRAFT: 'preparándose',
  BLOCKED: 'falta algo antes de crearla',
  READY: 'lista para crear',
  EXECUTING: 'creándose',
  PARTIAL: 'creada a medias: revísala',
  CREATED_PAUSED: 'creada y en pausa',
  FAILED: 'no se pudo crear',
  CANCELLED: 'cancelada',
};

export const ETIQUETA_MEDICION: Record<string, string> = {
  ACTION_MISSING: 'falta crearla en Google',
  ACTION_CREATED: 'creada en Google, sin medición instalada',
  TRACKING_MISSING: 'falta instalar la medición en tu sitio',
  TRACKING_INSTALLED: 'instalada, sin verificar',
  VERIFIED: 'verificada',
  DEGRADED: 'dejó de registrar',
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

const post = async (org: string, ruta: string, cuerpo: unknown = {}): Promise<VistaEjecucion> =>
  j<VistaEjecucion>(await fetch(`/api/backend/campana${ruta}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: JSON.stringify(cuerpo),
  }));

export async function leerEjecucion(org: string): Promise<VistaEjecucion> {
  return j<VistaEjecucion>(await fetch('/api/backend/campana/ejecucion', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export async function guardarMaterial(org: string, entrada: { ofertaSlug: string; titulares: string[]; descripciones: string[] }): Promise<VistaEjecucion> {
  return post(org, '/material', entrada);
}

export async function prepararMedicion(org: string): Promise<VistaEjecucion> {
  return post(org, '/medicion');
}

export async function actualizarMedicion(org: string, eventKey: string, accion: 'INSTALADA' | 'VERIFICAR'): Promise<VistaEjecucion> {
  return j<VistaEjecucion>(await fetch('/api/backend/campana/medicion', {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
    body: JSON.stringify({ eventKey, accion }),
  }));
}

export const prepararCampana = (org: string): Promise<VistaEjecucion> => post(org, '/ejecucion/preparar');
export const autorizarCampana = (org: string, id: string): Promise<VistaEjecucion> => post(org, `/ejecucion/${id}/autorizar`);
export const crearCampanaEnPausa = (org: string, id: string): Promise<VistaEjecucion> => post(org, `/ejecucion/${id}/ejecutar`);
export const reconciliarCampana = (org: string, id: string): Promise<VistaEjecucion> => post(org, `/ejecucion/${id}/reconciliar`);
export const cancelarCampana = (org: string, id: string): Promise<VistaEjecucion> => post(org, `/ejecucion/${id}/cancelar`);

export async function libroDeEjecucion(org: string, id: string): Promise<{ pasos: { paso: string; resultado: string; recurso: string | null; at: string }[] }> {
  return j(await fetch(`/api/backend/campana/ejecucion/${id}/libro`, { cache: 'no-store', headers: cabecerasOrg(org) }));
}
