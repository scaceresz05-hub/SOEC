/**
 * @soec/adaptadores — Frontera de Adaptadores Reales (M4-C de la Directiva PCE; sandbox endurecido en
 * M4-C-A-H). Contrato NEUTRAL para ejecutar una capacidad externa contra el mundo, con SANDBOX AUTORITATIVO
 * (identidad/tenant/modo/naturaleza/evidencia decididos por el sandbox, nunca por el adaptador), errores
 * normalizados, salud, cancelación autoritativa, timeout wall-clock opt-in, degradación gobernada,
 * inmutabilidad y validación canónica de `secretRef`. Adaptadores fake/grabados y evidencia reproducible.
 * Determinista y neutral (sin SDKs/red/entorno/reloj/aleatoriedad; el único timer vive en la capa opt-in).
 * La consumibilidad la decide `esConsumible` (M4-A); el valor de un secreto sólo vive tras el SecretStore
 * (M4-B). AUTONOMOUS_REAL permanece bloqueado.
 */
export * from './domain/errores-normalizados';
export * from './domain/estado-adaptador';
export * from './domain/degradacion';
export * from './domain/inmutable';
export * from './domain/evidencia';
export * from './domain/operativo-tipos';
export * from './domain/registro-adaptador';
export * from './domain/compatibilidad';
export * from './domain/health';
export * from './domain/circuit-breaker';
export * from './domain/retry';
export * from './domain/concurrencia';
export * from './port/adaptador-externo';
export * from './adapters/adaptador-fake';
export * from './adapters/adaptador-grabado';
export * from './app/timeout';
export * from './app/sandbox';
export * from './app/registro-adaptadores-service';
