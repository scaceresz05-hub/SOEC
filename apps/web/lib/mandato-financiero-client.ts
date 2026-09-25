/**
 * Cliente del PRESUPUESTO AUTORIZADO (vía BFF autenticado `/api/backend/mandato-financiero`).
 *
 * Aquí sólo viajan dos cifras y una moneda. No hay Customer ID, ni micros, ni sobres, ni permisos: autorizar
 * dinero es una decisión sola, y la pantalla que la recoge no debe pedir nada más.
 */
import { cabecerasOrg } from './org-activa';

export interface PresupuestoAutorizado {
  moneda: string;
  totalMaximo: number;
  maximoDiario: number | null;
  gastado: number;
  disponible: number;
  vigente: boolean;
  autorizadoPor: string;
  autorizadoEn: string | null;
  desde: string;
  hasta: string;
}

export interface VistaPresupuesto {
  organizationId: string;
  presupuesto: PresupuestoAutorizado | null;
  canal: string | null;
  /** La moneda que declaró la empresa. La pantalla NO propone ninguna: sin ella no se autoriza nada. */
  monedaDelNegocio: string | null;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { mensaje?: string; message?: string; error?: string };
    throw new Error(c.mensaje ?? c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerPresupuesto(org: string): Promise<VistaPresupuesto> {
  return j<VistaPresupuesto>(await fetch('/api/backend/mandato-financiero', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

/**
 * Registra la autorización. Los importes van en la unidad que escribe la persona —pesos, no milésimas— y el
 * servidor los convierte a su forma canónica: la pantalla no hace aritmética con el dinero de nadie.
 */
export async function autorizarPresupuesto(
  org: string,
  entrada: { moneda: string; totalMaximo: number; maximoDiario: number | null },
): Promise<VistaPresupuesto> {
  return j<VistaPresupuesto>(await fetch('/api/backend/mandato-financiero', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
    body: JSON.stringify({ ...entrada, canal: 'GOOGLE_ADS' }),
  }));
}

/** Importe tal como se lee en su moneda. Sin decimales cuando la moneda no los tiene. */
export function importe(monto: number, moneda: string): string {
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: 2 }).format(monto);
  } catch {
    return `${monto} ${moneda}`;
  }
}
