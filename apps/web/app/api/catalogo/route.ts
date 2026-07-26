import { API_BASE } from '../../../lib/config';

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/experience/catalogo`, { cache: 'no-store' });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' },
      { status: 502 },
    );
  }
}
