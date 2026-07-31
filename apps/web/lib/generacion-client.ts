/**
 * Cliente de la superficie AUTENTICADA del Motor de Generación (vía proxy /api/backend/*). La sesión
 * viaja en cookie httpOnly (NUNCA se lee un token en el navegador); la organización activa va en la
 * cabecera `x-organization-slug` y el gateway la valida contra la membresía. Todo es SIMULADO.
 */
import type {
  AprobacionGen,
  ArtefactoEstrategia,
  CampaniaGen,
  EntradaCalendarioGen,
  EstadoGeneracion,
  ExperimentoGen,
  PiezaGen,
  ResultadoStart,
} from './generacion-types';

const BASE = 'generation/programas';

function headers(org: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-organization-slug': org };
}

async function jget<T>(org: string, ruta: string): Promise<T> {
  const res = await fetch(`/api/backend/${ruta}`, { headers: headers(org), cache: 'no-store' });
  if (!res.ok) throw new Error(await mensajeError(res));
  return (await res.json()) as T;
}

async function jpost<T>(org: string, ruta: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend/${ruta}`, { method: 'POST', headers: headers(org), body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(await mensajeError(res));
  return (await res.json()) as T;
}

async function mensajeError(res: Response): Promise<string> {
  const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string; estado?: string; faltantes?: string[] };
  if (res.status === 401) return 'Necesitas iniciar sesión.';
  if (res.status === 403) return 'Tu rol no tiene permiso para esta acción.';
  if (res.status === 404) return 'No encontrado en tu organización.';
  if (res.status === 409 && c.estado === 'PENDIENTE_APROBACION') return 'Faltan aprobaciones humanas de las piezas.';
  return c.message ?? c.error ?? (c.faltantes ? c.faltantes.join('; ') : `error ${res.status}`);
}

const p = (programaId: string) => `${BASE}/${encodeURIComponent(programaId)}`;

export const iniciarGeneracion = (org: string, programaId: string, params: Record<string, unknown>): Promise<ResultadoStart> => jpost(org, `${p(programaId)}/start`, params);
export const reintentarGeneracion = (org: string, programaId: string, params: Record<string, unknown>): Promise<ResultadoStart> => jpost(org, `${p(programaId)}/retry`, params);
export const ejecutarSimulado = (org: string, programaId: string): Promise<{ estado: string; naturaleza: string }> => jpost(org, `${p(programaId)}/run-simulated`, { modo: 'PILOT' });
export const aprobarPieza = (org: string, programaId: string, piezaId: string, version: number): Promise<unknown> =>
  jpost(org, `${p(programaId)}/approvals`, { resourceType: 'PIEZA', resourceId: piezaId, resourceVersion: version, decision: 'APROBADA' });

export const estadoGeneracion = (org: string, programaId: string): Promise<EstadoGeneracion> => jget(org, p(programaId));
export const listarEstrategias = (org: string, programaId: string): Promise<{ estrategias: ArtefactoEstrategia[] }> => jget(org, `${p(programaId)}/creative-strategies`);
export const listarCampanias = (org: string, programaId: string): Promise<{ campanias: CampaniaGen[] }> => jget(org, `${p(programaId)}/campaigns`);
export const listarContenido = (org: string, programaId: string): Promise<{ piezas: PiezaGen[] }> => jget(org, `${p(programaId)}/content`);
export const listarExperimentos = (org: string, programaId: string): Promise<{ experimentos: ExperimentoGen[] }> => jget(org, `${p(programaId)}/experiments`);
export const listarCalendario = (org: string, programaId: string): Promise<{ entradas: EntradaCalendarioGen[] }> => jget(org, `${p(programaId)}/calendar`);
export const listarAprobaciones = (org: string, programaId: string): Promise<{ aprobaciones: AprobacionGen[] }> => jget(org, `${p(programaId)}/approvals`);
