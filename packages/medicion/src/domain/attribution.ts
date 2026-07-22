/**
 * Atribución conservadora (F2-MET-01 §5, §13). Distingue formalmente:
 *  - OBSERVACIÓN: dato recibido de una fuente.
 *  - ATRIBUCIÓN: relación soportada por un mecanismo identificable (p. ej. identificador de campaña).
 *  - INFERENCIA: interpretación probabilística/razonada.
 * Nunca se presenta una inferencia como atribución confirmada, ni la coincidencia
 * temporal como causalidad. Cada resultado declara su clase, modelo, ventana, evidencia,
 * confianza y limitaciones.
 */
export type ClaseEvidencia = 'observacion' | 'atribucion' | 'inferencia';
export type ModeloAtribucion = 'directa' | 'first_touch' | 'last_touch' | 'no_atribuida' | 'estimada' | 'manual';

export interface ConversionObservada {
  readonly id: string;
  readonly externalRef: string | null;
  readonly campaignRef: string | null; // identificador que habilita la atribución directa
  readonly valor: number;
  readonly ocurridoEn: string;
}

export interface Atribucion {
  readonly modelo: ModeloAtribucion;
  readonly version: string;
  readonly clase: ClaseEvidencia;
  readonly ventana: string;
  readonly conversiones: number;
  readonly valor: number;
  readonly evidencia: string;
  readonly confianza: 'baja' | 'media' | 'alta';
  readonly limitaciones: readonly string[];
}

export const ATRIBUCION_VERSION = 'atribucion@1';

/**
 * Atribuye conversiones a una campaña. Directa si portan el identificador de la campaña;
 * si no, se clasifica como INFERENCIA (no atribuida), nunca como conversión confirmada.
 */
export function atribuir(campaignRef: string, conversiones: readonly ConversionObservada[], ventana: string): Atribucion {
  const directas = conversiones.filter((c) => c.campaignRef === campaignRef);
  if (directas.length > 0) {
    return {
      modelo: 'directa',
      version: ATRIBUCION_VERSION,
      clase: 'atribucion',
      ventana,
      conversiones: directas.length,
      valor: directas.reduce((s, c) => s + c.valor, 0),
      evidencia: `${directas.length} conversión(es) con el identificador de campaña '${campaignRef}'`,
      confianza: 'alta',
      limitaciones: ['modelo de atribución directa por identificador; no captura efectos multi-touch'],
    };
  }
  const sinId = conversiones.filter((c) => !c.campaignRef);
  return {
    modelo: 'no_atribuida',
    version: ATRIBUCION_VERSION,
    clase: sinId.length > 0 ? 'inferencia' : 'observacion',
    ventana,
    conversiones: 0,
    valor: 0,
    evidencia: sinId.length > 0 ? `${sinId.length} conversión(es) sin identificador de campaña; posible relación no confirmada` : 'sin conversiones observadas',
    confianza: 'baja',
    limitaciones: ['no hay mecanismo de atribución; la coincidencia temporal no implica causalidad'],
  };
}
