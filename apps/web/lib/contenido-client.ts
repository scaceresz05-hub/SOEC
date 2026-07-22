import type { EstadoContenido, ResultadoPreparacion } from './contenido-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararContenido(): Promise<void> {
  await fetch('/api/contenido/preparar', { method: 'POST' });
}
export async function estadoContenido(): Promise<EstadoContenido> {
  return json<EstadoContenido>(await fetch('/api/contenido/estado', { cache: 'no-store' }));
}
export async function prepararTodo(): Promise<{ preparadas: number; desbloqueadas: number }> {
  return json(await fetch('/api/contenido/preparar-todo', { method: 'POST' }));
}
export async function prepararActividad(actividadId: string): Promise<ResultadoPreparacion> {
  return json<ResultadoPreparacion>(await fetch(`/api/contenido/actividad/${encodeURIComponent(actividadId)}`, { method: 'POST' }));
}
export async function ejecutarSiguienteContenido(): Promise<{ actividad: string | null; permitida: boolean; resultado: string }> {
  return json(await fetch('/api/contenido/ejecutar-siguiente', { method: 'POST' }));
}
