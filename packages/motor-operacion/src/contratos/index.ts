/**
 * @soec/motor-operacion · CONTRATOS (puertos).
 *
 * - `PuertoEjecucionSimulada`: frontera NEUTRAL de ejecución. El adaptador por defecto es determinista y
 *   estrictamente SIMULADO (patrón de `@soec/ejecucion-simulada`); el adaptador productivo (sandbox M4 de
 *   `@soec/adaptadores`) se enchufa aquí tras ratificación — nunca en este código. `AUTONOMOUS_REAL` bloqueado.
 * - `LecturaOperativa`: puerto de SOLO LECTURA para M8 (medición/optimización). M8 consume resultados;
 *   no puede modificar la ejecución histórica.
 */
import type { RequestContext } from '@soec/contracts';
import type { EstadoOrden, OrdenState } from '../dominio/orden';
import type { EvidenciaOperacional, ResultadoIntento } from '../dominio/evidencia';
import type { PlanEjecucion } from '../dominio/plan';
import type { TrabajoState } from '../dominio/cola';

/** Escenario del efecto simulado (determinista). Espeja `@soec/ejecucion-simulada`, sin canal real. */
export type EscenarioSimulado = 'EXITO' | 'FALLO_TEMPORAL' | 'FALLO_PERMANENTE' | 'RECHAZO';

export interface PeticionEjecucion {
  readonly organizacionId: string;
  readonly ordenId: string;
  readonly capacidad: string;
  readonly canalLogico: string;
  readonly claveEfecto: string;
  readonly intento: number;
  /** Instante observado (inyectado); el sandbox M4 lo usa como `observadoEn`. */
  readonly observadoEn: string;
}

export interface ResultadoEjecucion {
  readonly resultado: ResultadoIntento;
  readonly codigoError: string | null;
  readonly reintentable: boolean;
  readonly naturaleza: 'SIMULADA';
}

/** Frontera de ejecución: SIEMPRE simulada. Ningún adaptador real vive aquí hasta ratificación. */
export interface PuertoEjecucionSimulada {
  ejecutar(peticion: PeticionEjecucion): Promise<ResultadoEjecucion>;
}

/** Snapshot inmutable de una orden ejecutable/ejecutada, para M8 (solo lectura). */
export interface OrdenM8 {
  readonly ordenId: string;
  readonly estado: EstadoOrden;
  readonly intentos: number;
  readonly presupuestoReservado: number | null;
  readonly evidenciaRefs: readonly string[];
}

/** PUERTO DE LECTURA para M8. Solo lectura; no expone escritura ni estado mutable. */
export interface LecturaOperativa {
  cargarOrden(ctx: RequestContext, ordenId: string): Promise<OrdenState>;
  cargarPlan(ctx: RequestContext, ordenId: string): Promise<PlanEjecucion | null>;
  listarEvidencias(ctx: RequestContext, ordenId: string): Promise<readonly EvidenciaOperacional[]>;
  /** Órdenes en un estado dado (p. ej. EJECUTADA_SIMULADA) que M8 puede medir. Snapshots inmutables. */
  listarOrdenes(ctx: RequestContext, estado?: EstadoOrden): Promise<readonly OrdenM8[]>;
  cargarTrabajo(ctx: RequestContext, trabajoId: string): Promise<TrabajoState>;
}
