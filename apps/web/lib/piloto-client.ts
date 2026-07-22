import type { EstadoPiloto } from './piloto-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararPiloto(): Promise<void> {
  await fetch('/api/piloto/preparar', { method: 'POST' });
}
export async function estadoPiloto(): Promise<EstadoPiloto> {
  return json<EstadoPiloto>(await fetch('/api/piloto/estado', { cache: 'no-store' }));
}
export async function ensayar(escenario: string): Promise<{ ensId: string; resultado: string; pasos: number; incidencias: number; rollbackVerificado: boolean }> {
  return json(await fetch('/api/piloto/ensayar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ escenario }) }));
}
export async function intentarActivar(): Promise<{ permitida: boolean; motivoDenegacion: string; autorizacionesFaltantes: string[] }> {
  return json(await fetch('/api/piloto/activar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entorno: 'real_preparado' }) }));
}
