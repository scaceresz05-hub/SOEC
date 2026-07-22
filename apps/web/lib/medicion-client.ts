import type { EstadoMedicion } from './medicion-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararMedicion(): Promise<void> {
  await fetch('/api/medicion/preparar', { method: 'POST' });
}
export async function estadoMedicion(): Promise<EstadoMedicion> {
  return json<EstadoMedicion>(await fetch('/api/medicion/estado', { cache: 'no-store' }));
}
export async function sincronizar(escenario: string): Promise<{ medidas: number }> {
  return json(await fetch('/api/medicion/sincronizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ escenario }) }));
}
export async function optimizar(): Promise<{ propuestas: number; aplicadas: number; denegadas: number }> {
  return json(await fetch('/api/medicion/optimizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
}
