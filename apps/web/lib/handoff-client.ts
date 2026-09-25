/**
 * Cliente de TAREAS EXTERNAS (vía BFF autenticado `/api/backend/handoff`).
 *
 * El servidor decide qué falta y en qué orden; esta capa sólo transporta. Nunca recibe ni envía credenciales:
 * una tarea es una frase, un motivo y un botón.
 */
import { cabecerasOrg } from './org-activa';

export interface TareaPendiente {
  id: string;
  /** A qué canal pertenece. No se pinta: sirve para que la tarjeta de ese canal ceda la acción. */
  canal: string;
  titulo: string;
  motivo: string;
  etiquetaAccion: string;
  urlProveedor: string | null;
  /** Ya saliste al proveedor y estamos esperando a que el mundo cambie. */
  esperando: boolean;
  /** Hoy no se puede avanzar por una razón del proveedor. */
  bloqueadaFuera: boolean;
  /**
   * Cuando el proveedor no deja comprobar algo, lo único que cierra el paso es que la persona lo atestigüe.
   * Es una afirmación, no un formulario: no se le pide ni un dígito de nada.
   */
  confirmacion?: { etiqueta: string; recurso?: 'FACTURACION' | 'VERIFICACION' } | null;
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

/**
 * ATESTACIÓN. La persona confirma lo que Google no nos deja comprobar —que el pago de sus anuncios está
 * puesto—. El cuerpo va VACÍO a propósito: la cuenta la resuelve el servidor, y datos financieros no se piden
 * ni se envían. No crea mandato ni autoriza gasto: sólo cierra un paso que no era observable.
 */
export async function confirmarPago(org: string): Promise<{ estado: string }> {
  return confirmar(org, 'FACTURACION');
}

/**
 * Envía la atestación al recurso que corresponda. El servidor dice cuál en la propia tarea, para que la
 * pantalla no tenga que deducirlo del texto del botón. El cuerpo va vacío siempre: lo que se confirma es un
 * hecho, no un formulario.
 */
export async function confirmar(org: string, recurso: 'FACTURACION' | 'VERIFICACION' = 'FACTURACION'): Promise<{ estado: string }> {
  const ruta = recurso === 'VERIFICACION' ? 'verificacion/confirmacion' : 'facturacion/confirmacion';
  return j<{ estado: string }>(await fetch(`/api/backend/${ruta}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}',
  }));
}

/** Volver a comprobar contra el proveedor. Nadie marca nada como hecho: se verifica. */
export async function revisarTareas(org: string): Promise<VistaTareas> {
  return j<VistaTareas>(await fetch('/api/backend/handoff/revisar', {
    method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}',
  }));
}
