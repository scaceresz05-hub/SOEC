import { API_BASE } from '../../../lib/config';

/** Proxy server-side: inicia el análisis en la API pública de capacidades. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { executionId?: string };
  if (!body.executionId) {
    return Response.json({ error: 'MissingExecutionId' }, { status: 400 });
  }
  try {
    const res = await fetch(`${API_BASE}/experiencia/comprender-estado/analizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: body.executionId }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio de análisis.' }, { status: 502 });
  }
}
