/**
 * @soec/motor-medicion · dominio · ATRIBUCIÓN OPERACIONAL (política explícita, determinista).
 *
 * Distingue el GRADO de atribución y su CLASE epistémica (reutiliza `ClaseEvidencia` de @soec/medicion:
 * observación ╪ atribución ╪ inferencia). En M8 SIMULADO NUNCA se afirma causalidad real. Toda atribución
 * declara: modelo/política, ventana, eventos incluidos/excluidos, supuestos, sesgos, confianza y naturaleza.
 * Correlación ≠ causalidad; coincidencia temporal no es atribución confirmada.
 *
 * Grados: ASOCIACION_DIRECTA · CONTRIBUCION · CORRELACION · ATRIBUCION_DEBIL · DESCONOCIDA · NO_ATRIBUIBLE.
 */
import type { ClaseEvidencia, ModeloAtribucion } from '@soec/medicion';
import type { NaturalezaDato } from './observacion';

export type GradoAtribucion = 'ASOCIACION_DIRECTA' | 'CONTRIBUCION' | 'CORRELACION' | 'ATRIBUCION_DEBIL' | 'DESCONOCIDA' | 'NO_ATRIBUIBLE';
export const ATRIBUCION_OP_VERSION = 'atribucion-op@1';

export interface EntradaAtribucion {
  readonly kpiId: string;
  readonly modelo: ModeloAtribucion;
  readonly ventana: string;
  readonly eventosIncluidos: number;
  readonly eventosExcluidos: number;
  readonly hayIdentificadorDirecto: boolean; // p. ej. la conversión porta el id de la ejecución/campaña
  readonly haySenalContribuyente: boolean; // mecanismo plausible identificable (no solo tiempo)
  readonly soloCoincidenciaTemporal: boolean;
  readonly supuestos: readonly string[];
  readonly naturaleza: NaturalezaDato;
}

export interface AtribucionOperacional {
  readonly version: string;
  readonly kpiId: string;
  readonly grado: GradoAtribucion;
  readonly clase: ClaseEvidencia;
  readonly modelo: ModeloAtribucion;
  readonly ventana: string;
  readonly eventosIncluidos: number;
  readonly eventosExcluidos: number;
  readonly confianza: 'nula' | 'baja' | 'media';
  readonly supuestos: readonly string[];
  readonly sesgos: readonly string[];
  readonly limitaciones: readonly string[];
  readonly naturaleza: NaturalezaDato;
  readonly afirmaCausalidadReal: false; // invariante: M8 SIMULADO nunca afirma causalidad real
}

export function atribuir(e: EntradaAtribucion): AtribucionOperacional {
  const comun = {
    version: ATRIBUCION_OP_VERSION, kpiId: e.kpiId, modelo: e.modelo, ventana: e.ventana,
    eventosIncluidos: e.eventosIncluidos, eventosExcluidos: e.eventosExcluidos, supuestos: e.supuestos,
    naturaleza: e.naturaleza, afirmaCausalidadReal: false as const,
    limitaciones: ['dato SIMULADO/ESTIMADO: no representa causalidad real', 'correlación no implica causalidad'],
  };
  const mk = (grado: GradoAtribucion, clase: ClaseEvidencia, confianza: 'nula' | 'baja' | 'media', sesgos: string[]): AtribucionOperacional =>
    ({ ...comun, grado, clase, confianza, sesgos });

  if (e.eventosIncluidos === 0) return mk('NO_ATRIBUIBLE', 'inferencia', 'nula', ['sin eventos incluidos en la ventana']);
  if (e.hayIdentificadorDirecto) return mk('ASOCIACION_DIRECTA', 'atribucion', 'media', ['la asociación directa no prueba causalidad en datos simulados']);
  if (e.haySenalContribuyente) return mk('CONTRIBUCION', 'inferencia', 'baja', ['contribución inferida por mecanismo plausible, no confirmada']);
  if (e.soloCoincidenciaTemporal) return mk('CORRELACION', 'inferencia', 'baja', ['solo coincidencia temporal: alto riesgo de espuriedad']);
  if (e.eventosExcluidos > e.eventosIncluidos) return mk('ATRIBUCION_DEBIL', 'inferencia', 'baja', ['se excluyeron más eventos de los incluidos']);
  return mk('DESCONOCIDA', 'inferencia', 'nula', ['sin mecanismo identificable para atribuir']);
}
