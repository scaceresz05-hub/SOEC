/**
 * Definición versionada de capacidad (#14 §3, §13 de la orden).
 *
 * Una capacidad es una COMPOSICIÓN de operaciones intelectuales orientada a un
 * propósito humano (#14 §1-§2): compone operaciones, nunca al revés, y nunca otra
 * capacidad. Se declara por cuatro elementos —propósito, operaciones que compone,
 * producto conceptual, límite— y por su regla de composición versionada.
 *
 * Trazabilidad: #13 (operaciones que compone) · #14 (autoridad principal).
 */
import type { Attribution } from '@soec/contracts';

/** Solo las cuatro operaciones del #13 son componibles (no se inventan operaciones). */
export type OperacionComponible = 'esclarecer' | 'detectar' | 'proyectar' | 'orientar';
export const OPERACIONES_COMPONIBLES: readonly OperacionComponible[] = [
  'esclarecer',
  'detectar',
  'proyectar',
  'orientar',
];

/** Familias del marco extensible (#14 §4); guía, no catálogo cerrado. */
export type FamiliaCapacidad =
  | 'comprender-el-estado'
  | 'detectar-lo-no-visto'
  | 'anticipar'
  | 'preservar-y-transmitir'
  | 'orientar-una-decision';

/** Un paso de composición: una operación del #13, con su lugar en la estructura. */
export interface PasoComposicion {
  readonly stepId: string;
  readonly operacion: OperacionComponible;
  /** Por qué la capacidad usa esta operación (#14 anatomía; §6 de la orden). */
  readonly porque: string;
  /** Pasos previos de los que depende (secuencia). Vacío = independiente (paralelo). */
  readonly dependeDe: readonly string[];
  /** Qué producto intermedio alimenta la configuración de este paso (convergencia). */
  readonly usaProductoDe: string | null;
  readonly objetivoElementoId: string | null;
  readonly horizonte: string | null;
  /** Si este paso se abstiene, la capacidad se abstiene (condición de parada). */
  readonly obligatorio: boolean;
}

/** Contrato de producto de la capacidad: qué entrega y dónde se detiene (#14 §3 límite). */
export interface ContratoProducto {
  readonly entrega: string;
  readonly limite: string;
}

export interface DefinicionVersion {
  readonly version: number;
  readonly nombre: string;
  readonly proposito: string;
  readonly familia: FamiliaCapacidad;
  readonly pasos: readonly PasoComposicion[];
  readonly condicionesEntrada: readonly string[];
  readonly condicionesAbstencion: readonly string[];
  readonly contrato: ContratoProducto;
  /**
   * Capacidades referenciadas. En este bloque DEBE estar vacío: las capacidades se
   * componen de operaciones, no de otras capacidades (#14 §2, §7). Su presencia
   * solo existe para probar la protección contra ciclos.
   */
  readonly componeCapacidades: readonly string[];
  readonly vigencia: { readonly desde: string; readonly hasta: string | null };
  readonly atribucion: Attribution;
}
