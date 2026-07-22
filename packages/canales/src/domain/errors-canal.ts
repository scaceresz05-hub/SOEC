/**
 * Clasificación de errores de publicación (F2-CHAN-01 §16). Cada error indica
 * categoría, si es reintentable, evidencia y un mensaje seguro; el detalle técnico
 * se protege. Nunca se registran tokens, secretos ni datos personales sensibles.
 */
export type CategoriaError =
  | 'validacion'
  | 'autorizacion'
  | 'credencial'
  | 'rate_limit'
  | 'timeout'
  | 'red'
  | 'proveedor'
  | 'payload'
  | 'activo'
  | 'duplicado'
  | 'estado_desconocido'
  | 'no_recuperable';

export interface ErrorPublicacion {
  readonly codigo: string;
  readonly categoria: CategoriaError;
  readonly reintentable: boolean;
  readonly mensajeSeguro: string;
  /** Detalle técnico protegido (sin secretos ni datos personales). */
  readonly detalle: string;
  readonly evidencia: string;
}

const REINTENTABLES: ReadonlySet<CategoriaError> = new Set(['rate_limit', 'timeout', 'red', 'proveedor', 'estado_desconocido']);

export function esReintentable(categoria: CategoriaError): boolean {
  return REINTENTABLES.has(categoria);
}

export function errorPublicacion(codigo: string, categoria: CategoriaError, mensajeSeguro: string, detalle = '', evidencia = ''): ErrorPublicacion {
  return { codigo, categoria, reintentable: esReintentable(categoria), mensajeSeguro, detalle, evidencia };
}

/** Traduce un estado HTTP del proveedor a una categoría de error. */
export function categoriaDesdeHttp(status: number): CategoriaError {
  if (status === 401 || status === 403) return 'credencial';
  if (status === 422) return 'payload';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'estado_desconocido';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'proveedor';
  return 'proveedor';
}
