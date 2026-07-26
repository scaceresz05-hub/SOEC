import type {
  Catalogo,
  EntradaRespuesta,
  EvaluacionEstado,
  ListaEvaluaciones,
} from './evaluacion-types';

/** Mensajes comprensibles para códigos de error conocidos del servicio (fallback por `error`). */
const ERRORES_CONOCIDOS: Record<string, string> = {
  SeleccionRequerida: 'Selecciona una organización y un departamento válidos.',
  SeleccionInvalidaError: 'La organización o el departamento seleccionados no son válidos.',
  PreguntaFueraDelRubroError: 'La pregunta no pertenece al cuestionario del rubro.',
  EvaluacionInvalidaError: 'La evaluación no admite este cambio (¿está cerrada o archivada?).',
};
const MENSAJE_GENERICO =
  'No se pudo completar la acción. Revisa la selección e inténtalo nuevamente.';

/**
 * Deriva un mensaje comprensible del cuerpo de error del servicio.
 * Orden: `message` del servicio → mensaje conocido por `error` → genérico seguro.
 * Nunca expone códigos técnicos crudos ni stack traces.
 */
export function mensajeDeError(body: unknown): string {
  const b = body as { error?: unknown; message?: unknown } | null;
  if (b && typeof b.message === 'string' && b.message.trim() !== '') return b.message;
  if (b && typeof b.error === 'string' && ERRORES_CONOCIDOS[b.error])
    return ERRORES_CONOCIDOS[b.error]!;
  return MENSAJE_GENERICO;
}

async function comoError(res: Response): Promise<Error> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* respuesta sin JSON válido (p. ej. HTML de error): se usa el fallback genérico */
  }
  return new Error(mensajeDeError(body));
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await comoError(res);
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
