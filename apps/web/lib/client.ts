/** Cliente de navegador: llama a los route handlers de Next (misma-origin). */
import type { ResultadoExperiencia, ResumenHistorial } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly recuperable: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 502) throw new ApiError('El servicio no está disponible ahora. Puedes reintentar.', true);
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok && res.status !== 404) throw new ApiError('Ocurrió un problema al obtener el resultado.', true);
  return data;
}

/** Inicia (o recupera, si ya existe) el análisis. Idempotente por executionId. */
export async function analizar(executionId: string): Promise<ResultadoExperiencia> {
  const res = await fetch('/api/analizar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ executionId }),
  });
  return jsonOrThrow<ResultadoExperiencia>(res);
}

export async function historial(): Promise<ResumenHistorial[]> {
  const res = await fetch('/api/historial', { cache: 'no-store' });
  const data = await jsonOrThrow<{ historial: ResumenHistorial[] }>(res);
  return data.historial ?? [];
}

export async function detalle(id: string): Promise<ResultadoExperiencia | null> {
  const res = await fetch(`/api/analisis/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  return jsonOrThrow<ResultadoExperiencia>(res);
}

/** Genera un identificador de ejecución en el navegador (evita duplicados por doble clic). */
export function nuevoId(): string {
  return `ce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
