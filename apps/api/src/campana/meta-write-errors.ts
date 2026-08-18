/**
 * apps/api · V2 PRE-REAL · ERROR MODEL de escritura Meta. Clasifica errores en clases tipadas para decidir
 * si una operación es reintentable o no (nunca retry ciego). No expone token/secreto/payload sensible.
 */

export type ClaseErrorEscritura =
  | 'AUTH'
  | 'SCOPE_MISSING'
  | 'RATE_LIMIT'
  | 'META_POLICY'
  | 'INVALID_ASSET'
  | 'INVALID_CREATIVE'
  | 'BUDGET_GUARD'
  | 'NETWORK'
  | 'CONFLICT'
  | 'UNKNOWN';

/** Clases NO reintentables (retry no ayuda o es peligroso). El resto puede reintentarse con backoff. */
const NO_REINTENTABLES: ReadonlySet<ClaseErrorEscritura> = new Set(['AUTH', 'SCOPE_MISSING', 'META_POLICY', 'INVALID_ASSET', 'INVALID_CREATIVE', 'BUDGET_GUARD', 'CONFLICT']);

export function esReintentable(clase: ClaseErrorEscritura): boolean {
  return !NO_REINTENTABLES.has(clase);
}

export class ErrorEscrituraMeta extends Error {
  constructor(readonly clase: ClaseErrorEscritura, mensaje: string, readonly reintentable = esReintentable(clase)) {
    super(mensaje);
    this.name = 'ErrorEscrituraMeta';
  }
}

/**
 * Clasifica una respuesta de error de Graph. Usa el `code`/`error_subcode` del cuerpo Graph cuando existe.
 * No incluye el cuerpo crudo en el mensaje (podría traer datos sensibles): sólo un resumen tipado.
 */
export function clasificarErrorGraph(status: number, body: unknown): ClaseErrorEscritura {
  const err = (body as { error?: { code?: number; error_subcode?: number; type?: string; is_transient?: boolean } } | undefined)?.error;
  const code = err?.code;
  const sub = err?.error_subcode;
  if (status === 0) return 'NETWORK';
  if (code === 190 || sub === 463 || sub === 467 || status === 401) return 'AUTH'; // token inválido/expirado
  if (code === 10 || code === 200 || code === 3 || code === 803) return 'SCOPE_MISSING'; // permiso faltante
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004 || status === 429) return 'RATE_LIMIT';
  if (code !== undefined && code >= 1487000 && code <= 1487999) return 'META_POLICY'; // políticas de anuncios
  if (code === 100 && (sub === 1487056 || sub === 1815219)) return 'INVALID_CREATIVE';
  if (code === 100) return 'INVALID_ASSET'; // parámetro/objeto inválido
  if (status === 409 || code === 368) return 'CONFLICT';
  if (err?.is_transient === true || (status >= 500 && status <= 599)) return 'NETWORK';
  return 'UNKNOWN';
}
