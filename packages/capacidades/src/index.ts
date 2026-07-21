/**
 * @soec/capacidades — Sistema de Capacidades ejecutable.
 *
 * Realiza el Documento #14: una capacidad COMPONE operaciones intelectuales (#13)
 * para un propósito humano (nunca al revés, nunca otra capacidad). Consume las
 * operaciones SOLO por su puerto público (`OperacionesPort`), jamás el ECE/MED/MDM
 * directamente. Entrega un producto compuesto y NO vinculante al juicio de la
 * persona; puede abstenerse; no ejecuta acciones ni decide. Definiciones
 * versionadas, registro con rechazo de ciclos, orquestador, persistencia y
 * proyecciones reconstruibles. No implementa interfaces ni acciones externas.
 */
export * from './domain/definition';
export * from './domain/product';
export * from './domain/aggregate-definition';
export * from './domain/aggregate-execution';
export * from './domain/errors';
export * from './app/registry';
export * from './app/orchestrator';
export * from './app/query-service';
export * from './projections/projection';
