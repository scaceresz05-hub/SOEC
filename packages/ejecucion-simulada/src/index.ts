/**
 * @soec/ejecucion-simulada — Adaptadores de canal SIMULADOS y auditables (Bloque E del Director
 * de Marketing Autónomo V1). Ejecución determinista con escenarios configurables, idempotencia
 * que impide publicaciones duplicadas, y un registro por intento etiquetado como simulado con
 * adaptador, requestId e idempotencyKey. Base para la medición (Bloque F) bajo el modo seguro
 * (Bloque H).
 */
export * from './domain/ejecucion';
export * from './domain/adaptador';
export * from './domain/errors';
export * from './app/ejecucion-service';
