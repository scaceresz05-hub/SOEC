/**
 * Cliente de TAREAS EXTERNAS (vía BFF autenticado `/api/backend/handoff`).
 *
 * El servidor decide qué falta y en qué orden; esta capa sólo transporta. Nunca recibe ni envía credenciales:
 * una tarea es una frase, un motivo y un botón.
 */
import { cabecerasOrg } from './org-activa';

export interface TareaPendiente {
  id: string;
  titulo: string;
  motivo: string;
  etiquetaAccion: string;
  urlProveedor: string | null;
  /** Ya saliste al proveedor y estamos esperando a que el mundo cambie. */
  esperando: boolean;
  /** Hoy no se puede avanzar por una razón del proveedor. */
  bloqueadaFuera: boolean;
}

export interface VistaTareas {
  organizationId: string;
  tarea: TareaPendiente | null;
  /** Cuántas quedan detrás. Se cuentan; no se listan como diez bloqueos técnicos. */
  pendientes: number;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerTarea(org: string): Promise<VistaTareas> {
  return j<VistaTareas>(await fetch('/api/backend/handoff', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

/** La persona pulsó el botón y salió al proveedor: la tarea pasa a esperar al mundo. */
export async function marcarAbierta(org: string, id: string): Promise<VistaTareas> {
  return j<VistaTareas>(await fetch(`/api/backend/handoff/${id}/abierta`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}',
  }));
}

/** Volver a comprobar contra el proveedor. Nadie marca nada como hecho: se verifica. */
export async function revisarTareas(org: string): Promise<VistaTareas> {
  return j<VistaTareas>(await fetch('/api/backend/handoff/revisar', {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}',
  }));
}
