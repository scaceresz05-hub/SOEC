/**
 * Frontera generativa independiente (F2-CONT-01 §9). El dominio NO depende de
 * ningún proveedor (OpenAI/Anthropic/Google/…): define un puerto reemplazable.
 * Toda solicitud es estructurada y toda respuesta se valida; ningún texto del
 * proveedor entra directamente como contenido confiable. El sistema funciona en
 * modo determinista/fixture cuando no hay credencial. Ningún efecto externo real.
 */
import type { RequestContext } from '@soec/contracts';

export type TareaGenerativa = 'pieza_fuente' | 'adaptacion_canal' | 'traduccion' | 'brief_mensaje';

/** Salida estructurada del proveedor: campos de texto y listas, nunca prosa cruda confiable. */
export interface SalidaGenerada {
  readonly campos: Readonly<Record<string, string>>;
  readonly listas: Readonly<Record<string, readonly string[]>>;
}

export interface SolicitudGenerativa {
  readonly tarea: TareaGenerativa;
  /** Contexto estructurado (marca, audiencia, canal…) como pares clave/valor. */
  readonly contexto: Readonly<Record<string, string>>;
  /** Claves de campo que la salida DEBE contener (esquema mínimo). */
  readonly esquemaSalida: readonly string[];
  readonly idioma: string;
  /** Límite de caracteres por campo (0 = sin límite). */
  readonly limiteCaracteres: number;
  /** Subcadenas que la salida NO debe contener (usado por la revisión automática). */
  readonly evitar: readonly string[];
  /** Referencia a la plantilla de prompt versionada que origina la solicitud. */
  readonly promptRef: string;
  /** Trazabilidad: a qué brief/pieza pertenece. */
  readonly trazabilidad: string;
  readonly timeoutMs?: number;
}

export type EstadoRespuesta = 'valida' | 'invalida' | 'timeout' | 'error';

export interface UsoGenerativo {
  readonly unidades: number;
  readonly costoEstimado: number;
}

export interface RespuestaGenerativa {
  readonly estado: EstadoRespuesta;
  readonly salida: SalidaGenerada | null;
  readonly proveedorLogico: string;
  readonly modeloLogico: string;
  /** Tiempo lógico del proveedor (ISO); provisto por el llamador (no Date.now interno). */
  readonly generadoEn: string;
  readonly uso: UsoGenerativo;
  readonly advertencias: readonly string[];
  readonly promptRef: string;
}

/**
 * Puerto neutral del generador. Reemplazable; el proveedor por defecto es
 * determinista (fixture). Un adaptador real solo puede existir desactivado, sin
 * secretos obligatorios y sin efectos de publicación (§9.3).
 */
export interface ProveedorGenerativo {
  readonly nombre: string;
  readonly version: string;
  generar(ctx: RequestContext, solicitud: SolicitudGenerativa, signal?: AbortSignal): Promise<RespuestaGenerativa>;
}

/** Valida que la salida contenga las claves del esquema y respete los límites. */
export function validarRespuesta(r: RespuestaGenerativa, esquema: readonly string[], limite: number): { valida: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (r.estado !== 'valida') motivos.push(`estado_${r.estado}`);
  const salida = r.salida;
  if (!salida) {
    motivos.push('sin_salida');
    return { valida: false, motivos };
  }
  for (const clave of esquema) {
    const v = salida.campos[clave];
    if (v === undefined || v.trim() === '') motivos.push(`campo_faltante:${clave}`);
    else if (limite > 0 && v.length > limite) motivos.push(`campo_excede_limite:${clave}`);
  }
  return { valida: motivos.length === 0, motivos };
}
