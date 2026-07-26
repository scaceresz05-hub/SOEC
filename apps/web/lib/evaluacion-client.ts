import type {
  Catalogo,
  EntradaRespuesta,
  EvaluacionEstado,
  ListaEvaluaciones,
} from './evaluacion-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`fallo de servicio (${res.status})`);
  return (await res.json()) as T;
}
const jbody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const q = (org: string, dep: string) =>
  `org=${encodeURIComponent(org)}&departamento=${encodeURIComponent(dep)}`;

export async function obtenerCatalogo(): Promise<Catalogo> {
  return json(await fetch('/api/catalogo', { cache: 'no-store' }));
}

export async function listarEvaluaciones(org: string, dep: string): Promise<ListaEvaluaciones> {
  return json(await fetch(`/api/evaluacion/lista?${q(org, dep)}`, { cache: 'no-store' }));
}

export async function iniciarEvaluacion(
  org: string,
  dep: string,
  titulo: string,
): Promise<EvaluacionEstado> {
  return json(await fetch('/api/evaluacion/iniciar', jbody({ org, departamento: dep, titulo })));
}

export async function obtenerEvaluacion(
  org: string,
  dep: string,
  evaluacionId: string,
): Promise<EvaluacionEstado> {
  return json(
    await fetch(
      `/api/evaluacion/estado?${q(org, dep)}&evaluacionId=${encodeURIComponent(evaluacionId)}`,
      { cache: 'no-store' },
    ),
  );
}

export async function responderEvaluacion(
  org: string,
  dep: string,
  evaluacionId: string,
  preguntaId: string,
  entrada: EntradaRespuesta,
): Promise<EvaluacionEstado> {
  return json(
    await fetch(
      '/api/evaluacion/responder',
      jbody({ org, departamento: dep, evaluacionId, preguntaId, entrada }),
    ),
  );
}

export async function generarEvaluacion(
  org: string,
  dep: string,
  evaluacionId: string,
): Promise<EvaluacionEstado> {
  return json(
    await fetch('/api/evaluacion/generar', jbody({ org, departamento: dep, evaluacionId })),
  );
}

export async function cerrarEvaluacion(
  org: string,
  dep: string,
  evaluacionId: string,
): Promise<EvaluacionEstado> {
  return json(
    await fetch('/api/evaluacion/cerrar', jbody({ org, departamento: dep, evaluacionId })),
  );
}
