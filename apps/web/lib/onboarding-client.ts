/**
 * Cliente del ASISTENTE DE INCORPORACIÓN (vía BFF autenticado `/api/backend/onboarding`).
 *
 * La interfaz no sabe qué preguntas existen: las recibe del servidor ya resueltas (qué aplica a este negocio,
 * qué se sabe ya, qué falta). Así la conversación puede cambiar sin tocar el front, y las ramas condicionales
 * se prueban una sola vez donde viven.
 */
import { cabecerasOrg } from './org-activa';

export type TipoPregunta = 'TEXTO' | 'TEXTO_LARGO' | 'OPCION' | 'OPCIONES' | 'LISTA_TEXTO' | 'NUMERO' | 'SI_NO';
export type EstadoOnboarding = 'NOT_STARTED' | 'IN_PROGRESS' | 'NEEDS_ACTION' | 'COMPLETE';
export type EstadoDominio = 'COMPLETE' | 'INCOMPLETE' | 'OPTIONAL' | 'ACTION_REQUIRED';

export interface OpcionPregunta {
  valor: string;
  etiqueta: string;
  ayuda?: string;
}

export interface PreguntaVista {
  id: string;
  etiqueta: string;
  ayuda: string | null;
  tipo: TipoPregunta;
  opciones: OpcionPregunta[];
  requerida: boolean;
  valorActual: unknown;
  procedencia: 'USER' | 'WEBSITE' | 'CONNECTOR' | 'DERIVED' | null;
  confirmacion: 'DISCOVERED' | 'USER_CONFIRMED' | null;
  yaSabemos: boolean;
}

export interface PasoVista {
  id: string;
  titulo: string;
  descripcion: string;
  estado: 'PENDIENTE' | 'COMPLETO';
  preguntas: PreguntaVista[];
}

export interface DominioEvaluado {
  dominio: string;
  estado: EstadoDominio;
  motivos: { campo: string; motivo: string; comoSeResuelve: string }[];
}

export interface NivelEvaluado {
  nivel: string;
  listo: boolean;
  bloqueos: string[];
}

export interface VistaOnboarding {
  organizationId: string;
  estado: EstadoOnboarding;
  pasoActual: string;
  siguientePaso: string;
  progreso: number;
  pasos: PasoVista[];
  readiness: {
    dominios: DominioEvaluado[];
    niveles: NivelEvaluado[];
    resumen: 'LISTO' | 'FALTA_INFORMACION' | 'REQUIERE_TU_ACCION';
  };
  resumen: {
    empresa: string;
    aQueSeDedica: string | null;
    oferta: string[];
    objetivo: string | null;
    territorio: string[];
    conversiones: string[];
    restricciones: string[];
    conexiones: { nombre: string; estado: string }[];
    presupuestoMaximo: string;
    nivelDeAutonomia: string;
  };
  sitio: { url: string; estado: string; titulo: string | null; paginas: string[] } | null;
}

/** Nombres en lenguaje de negocio para el resumen de preparación. Nada de vocabulario interno. */
export const NOMBRE_DOMINIO: Record<string, string> = {
  BUSINESS_PROFILE: 'Tu empresa',
  OFFER: 'Lo que vendes',
  GEOGRAPHY: 'Dónde atiendes',
  OBJECTIVE: 'Qué quieres conseguir',
  CONVERSIONS: 'Cómo te contactan',
  RESTRICTIONS: 'Lo que no debemos decir',
  EVALUATION: 'Cómo sabremos si funciona',
  CONNECTIONS: 'Fuentes de datos',
  FINANCIAL_MANDATE: 'Máximo a invertir',
  GOVERNANCE: 'Permisos',
};

export const NOMBRE_NIVEL: Record<string, string> = {
  BUSINESS_READY: 'SOEC entiende tu empresa',
  MEASUREMENT_READY: 'SOEC puede medir lo que pasa',
  CAMPAIGN_PLANNING_READY: 'SOEC puede preparar una propuesta',
  CAMPAIGN_EXECUTION_READY: 'SOEC podría ejecutar campañas',
  AUTONOMY_READY: 'SOEC podría operar por su cuenta',
};

export const ETIQUETA_ESTADO_DOMINIO: Record<EstadoDominio, string> = {
  COMPLETE: 'listo',
  INCOMPLETE: 'falta información',
  OPTIONAL: 'opcional',
  ACTION_REQUIRED: 'requiere tu acción',
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerOnboarding(org: string): Promise<VistaOnboarding> {
  return j<VistaOnboarding>(await fetch('/api/backend/onboarding', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export async function guardarPaso(
  org: string,
  paso: string,
  respuestas: Record<string, unknown>,
  avanzar: boolean,
): Promise<VistaOnboarding> {
  return j<VistaOnboarding>(
    await fetch('/api/backend/onboarding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: JSON.stringify({ paso, respuestas, avanzar }),
    }),
  );
}

export async function revisarSitio(org: string, url?: string): Promise<VistaOnboarding> {
  return j<VistaOnboarding>(
    await fetch('/api/backend/onboarding/sitio', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: JSON.stringify({ ...(url ? { url } : {}) }),
    }),
  );
}

export async function completarOnboarding(org: string): Promise<VistaOnboarding> {
  return j<VistaOnboarding>(
    await fetch('/api/backend/onboarding/completar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: '{}',
    }),
  );
}

export async function reabrirOnboarding(org: string): Promise<VistaOnboarding> {
  return j<VistaOnboarding>(
    await fetch('/api/backend/onboarding/reabrir', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: '{}',
    }),
  );
}
