import type { VistaCicloDirector } from './director-autonomo-types';

async function json(res: Response): Promise<VistaCicloDirector> {
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as { mensaje?: string; error?: string };
    throw new Error(cuerpo.mensaje ?? cuerpo.error ?? 'fallo de servicio del Director Autónomo');
  }
  return (await res.json()) as VistaCicloDirector;
}

/** La vista del ciclo reconstruida (read-only) para una organización. */
export async function obtenerEstado(org: string): Promise<VistaCicloDirector> {
  return json(await fetch(`/api/director-autonomo/estado?org=${encodeURIComponent(org)}`, { cache: 'no-store' }));
}

/** Corre el ciclo gobernado (simulado) y lo persiste; devuelve la traza (incluye la vista). */
export async function ejecutarCiclo(org: string): Promise<{ vista: VistaCicloDirector } & Record<string, unknown>> {
  const res = await fetch('/api/director-autonomo/ejecutar-ciclo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org }),
  });
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as { mensaje?: string; error?: string };
    throw new Error(cuerpo.mensaje ?? cuerpo.error ?? 'no se pudo ejecutar el ciclo');
  }
  return (await res.json()) as { vista: VistaCicloDirector } & Record<string, unknown>;
}

/** Activa el modo seguro (PAUSA) para la organización. */
export async function pausar(org: string, motivo: string): Promise<VistaCicloDirector> {
  return json(
    await fetch('/api/director-autonomo/pausar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, motivo }),
    }),
  );
}

/** Reanuda desde el modo seguro. Exige un actor humano identificado. */
export async function reanudar(org: string, actorHumano: string, motivo: string): Promise<VistaCicloDirector> {
  return json(
    await fetch('/api/director-autonomo/reanudar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, actorHumano, motivo }),
    }),
  );
}
