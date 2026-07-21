/**
 * Producto de capacidad: resultado COMPUESTO y NO vinculante ofrecido a una persona.
 *
 * No oculta los productos intelectuales que lo originaron, no reduce el proceso a
 * una conclusión opaca, no convierte orientación en mandato, detección en alerta
 * vinculante, proyección en plan ni esclarecimiento en verdad definitiva (§10).
 * Conserva contradicciones abiertas y las remite al juicio humano.
 */
import type { Attribution } from '@soec/contracts';
import type { OperacionComponible } from './definition';

export interface PasoEjecutado {
  readonly stepId: string;
  readonly operacion: OperacionComponible;
  readonly operacionExecutionId: string;
  readonly abstenido: boolean;
  readonly causaAbstencion: string | null;
  readonly resumen: string;
}

export interface ProductoCapacidad {
  readonly capabilityId: string;
  readonly version: number;
  readonly nombre: string;
  readonly proposito: string;
  readonly operacionesEjecutadas: readonly PasoEjecutado[];
  /** Referencias a las ejecuciones intelectuales (executionIds) — nunca se ocultan. */
  readonly productosIntermedios: readonly string[];
  /** Composición explicable, línea por línea (no una conclusión opaca). */
  readonly productoCompuesto: readonly string[];
  readonly evidencia: readonly string[];
  readonly procedencia: string;
  readonly incertidumbre: string;
  readonly limitaciones: readonly string[];
  readonly faltante: readonly string[];
  /** Contradicciones conservadas y remitidas al juicio humano. */
  readonly contradiccionesAbiertas: readonly string[];
  readonly cuestionesJuicioHumano: readonly string[];
  readonly abstenido: boolean;
  readonly causaAbstencion: string | null;
  readonly pasoAfectado: string | null;
  /** Garantía estructural: una capacidad jamás es una decisión vinculante. */
  readonly bindingDecision: false;
  readonly atribucion: Attribution;
}

/** Soberanía (#14 inv. 3, §11): una capacidad ofrece; nunca decide ni ejecuta. */
export function violaSoberaniaCapacidad(p: ProductoCapacidad): boolean {
  return (p as { bindingDecision: unknown }).bindingDecision !== false;
}

/**
 * Anti-atrofia (#14 inv. 6, §12): el producto debe permitir comprender cómo se
 * llegó a él. No puede ocultar las operaciones, ni ser una conclusión sin soporte,
 * ni dejar nada al juicio humano.
 */
export function esOpacaCapacidad(p: ProductoCapacidad): boolean {
  if (p.abstenido) {
    return p.causaAbstencion === null || (p.faltante.length === 0 && p.limitaciones.length === 0);
  }
  if (p.operacionesEjecutadas.length === 0) return true; // ocultaría las operaciones
  if (p.cuestionesJuicioHumano.length === 0) return true; // no deja nada al juicio humano
  const tieneSoporte = p.productoCompuesto.length > 0 || p.evidencia.length > 0 || p.faltante.length > 0;
  return !tieneSoporte;
}
