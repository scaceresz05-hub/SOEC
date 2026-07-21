import type { EstadoMarketing, ResultadoEjecucion } from './marketing-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararMarketing(): Promise<void> {
  await fetch('/api/marketing/preparar', { method: 'POST' });
}
export async function estadoMarketing(): Promise<EstadoMarketing> {
  return json<EstadoMarketing>(await fetch('/api/marketing/estado', { cache: 'no-store' }));
}
export async function ejecutarSiguiente(): Promise<ResultadoEjecucion> {
  return json<ResultadoEjecucion>(await fetch('/api/marketing/ejecutar-siguiente', { method: 'POST' }));
}
export async function replanificar(): Promise<{ planVersion: number }> {
  return json(await fetch('/api/marketing/replanificar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ motivo: 'replanificación desde el centro de control' }) }));
}
export async function pausarPlan(): Promise<void> {
  await fetch('/api/marketing/pausar', { method: 'POST' });
}
export async function reanudarPlan(): Promise<void> {
  await fetch('/api/marketing/reanudar', { method: 'POST' });
}
