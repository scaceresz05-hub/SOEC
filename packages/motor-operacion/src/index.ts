/**
 * @soec/motor-operacion — Motor de Operación y Ejecución Gobernada (M7).
 *
 * Transforma artefactos creativos APROBADOS+VIGENTES+CALENDARIZADOS de M6 (`LecturaCreativa`) en
 * ejecuciones gobernadas, medibles y recuperables — SIEMPRE SIMULADAS. Reutiliza: presupuesto M4-D,
 * evidencia/retry/breaker de la frontera de adaptadores M4, y el patrón de ejecución simulada. Aporta:
 * la Orden de Ejecución (11 estados), el plan, el scheduler-gate, la cola con lease, el ejecutor gobernado
 * idempotente, la reconciliación y los contratos de lectura para M8. `AUTONOMOUS_REAL` bloqueado.
 */
export * from './dominio/orden';
export * from './dominio/cola';
export * from './dominio/idempotencia';
export * from './dominio/plan';
export * from './dominio/evidencia';
export * from './dominio/errors';
export * from './contratos';
export { AdaptadorEjecucionSimulado } from './app/adaptador-simulado';
export { AdaptadorSandboxM4 } from './app/adaptador-sandbox-m4';
export { OperacionService, type EntradaOrden, type OpcionesOperacion } from './app/operacion-service';
export { LecturaOperativaService } from './app/lectura-operativa-service';
export { ReconciliadorService, type HallazgoReconciliacion, type ClaseHallazgo } from './app/reconciliador-service';
