import type { EstadoCanales, PublicacionResumen } from './canales-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararCanales(): Promise<void> {
  await fetch('/api/canales/preparar', { method: 'POST' });
}
export async function estadoCanales(): Promise<EstadoCanales> {
  return json<EstadoCanales>(await fetch('/api/canales/estado', { cache: 'no-store' }));
}
export async function publicarTodo(): Promise<{ publicadas: number; verificadas: number; bloqueadas: number }> {
  return json(await fetch('/api/canales/publicar-todo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
}
export async function publicarActividad(id: string, canal: string): Promise<PublicacionResumen> {
  return json<PublicacionResumen>(await fetch(`/api/canales/actividad/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canal }) }));
}
export async function retirarActividad(id: string, canal: string): Promise<PublicacionResumen> {
  return json<PublicacionResumen>(await fetch(`/api/canales/actividad/${encodeURIComponent(id)}/retirar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canal }) }));
}
