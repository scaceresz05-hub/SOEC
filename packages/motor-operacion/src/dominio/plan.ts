/**
 * @soec/motor-operacion · dominio · PLAN DE EJECUCIÓN (neutral, sin SDK ni datos de proveedor).
 *
 * Deriva de una orden VALIDADA: describe qué capacidad se necesita, qué artefacto usa, cuándo debe
 * ejecutarse, qué límites/retry aplican, qué resultado se espera, qué KPI futuro medirá M8, y qué
 * compensación corresponde ante fallo. No contiene SDK, credenciales ni cuerpos de proveedor.
 */
import type { RefVersionada } from './orden';

/** Compensación lógica ante fallo (acción inversa registrada; nunca promete revertir efectos reales). */
export type TipoCompensacion = 'NINGUNA' | 'MARCAR_NO_PUBLICADA' | 'LIBERAR_RESERVA' | 'REGISTRAR_REVERSO';

export interface PlanEjecucion {
  readonly ordenId: string;
  readonly capacidad: string;
  readonly pieza: RefVersionada;
  readonly variante: RefVersionada | null;
  readonly canalLogico: string;
  readonly instantePlanificado: string;
  readonly limiteConcurrencia: number;
  readonly maxIntentos: number;
  readonly resultadoEsperado: string;
  /** KPI futuro que M8 medirá (tipo lógico, sin valor real todavía). */
  readonly kpiFuturo: string;
  readonly compensacion: TipoCompensacion;
  readonly naturaleza: 'SIMULADO';
}
