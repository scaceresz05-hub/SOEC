import { API_BASE } from '../../../lib/config';

/** Proxy server-side: historial de análisis. */
export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/experiencia/comprender-estado/historial`, { cache: 'no-store' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}
