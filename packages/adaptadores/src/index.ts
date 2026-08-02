/**
 * @soec/adaptadores — Frontera de Adaptadores Reales (M4-C de la Directiva PCE). Contrato NEUTRAL para
 * ejecutar una capacidad externa contra el mundo, con sandbox local, adaptadores fake/grabados, evidencia
 * reproducible, errores normalizados, salud, timeout y cancelación. Determinista y neutral (sin SDKs/red/
 * entorno/reloj/aleatoriedad). Todo adaptador real nace DESACTIVADO/SIMULADO/SIN_CREDENCIAL/NO_CONSUMIBLE
 * y sólo avanza por actos humanos auditados; la consumibilidad la decide `esConsumible` (M4-A) y el valor
 * de un secreto sólo vive tras el `SecretStore` (M4-B). AUTONOMOUS_REAL permanece bloqueado.
 */
export * from './domain/errores-normalizados';
export * from './domain/estado-adaptador';
export * from './domain/evidencia';
export * from './port/adaptador-externo';
export * from './adapters/adaptador-fake';
export * from './adapters/adaptador-grabado';
export * from './app/sandbox';
