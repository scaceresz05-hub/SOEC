/**
 * @soec/operacional — Plano operativo: ejecución de acciones de marketing
 * AUTORIZADAS POR POLÍTICA (ADR-0009, Const. v1.7).
 *
 * Ninguna acción se ejecuta sin una política vigente que la autorice; la
 * autorización es evaluable (permitir/denegar con motivo) y auditable; la
 * ejecución es idempotente, verificada, reversible donde sea posible y trazable.
 * En este bloque los efectos son SIMULADOS (Efecto.simulado === true): ningún
 * efecto externo real. La persona conserva la autoridad estratégica, la supervisión,
 * la revocación y el interruptor de emergencia.
 */
export * from './domain/policy';
export * from './domain/action';
export * from './domain/authorization';
export * from './domain/channel';
export * from './domain/errors';
export * from './app/policy-service';
export * from './app/operational-service';
export * from './app/adapters/simulated';
export * from './projections/projection';
