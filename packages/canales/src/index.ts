/**
 * @soec/canales — Primer Adaptador de Publicación Controlada (F2-CHAN-01).
 *
 * Plano de canales proveedor-independiente: consume un paquete publicable, lo
 * autoriza por el plano operacional (única puerta al efecto), lo mapea al payload de
 * un canal y ejecuta un ciclo de publicación CONTROLADA (preparar → enviar → verificar
 * → reconciliar → auditar) contra un adaptador REEMPLAZABLE. Dos modos habilitados:
 * `simulado` (sin red) y `sandbox` (proveedor EMULADO por HTTP); el modo `real` está
 * DESACTIVADO por guardarraíl. Idempotencia externa, credenciales por referencia
 * (nunca secretos en eventos/logs), rate limiting, webhooks y retiro. Ningún efecto
 * público real; sin gasto; sin credenciales reales.
 */
export * from './domain/modes';
export * from './domain/capabilities';
export * from './domain/credentials';
export * from './domain/errors-canal';
export * from './domain/ratelimit';
export * from './domain/ports';
export * from './domain/webhook';
export * from './domain/reconciliation';
export * from './domain/publication';
export * from './domain/errors';
export * from './app/capabilities-catalog';
export * from './app/paquete-mapper';
export * from './app/publication-service';
export * from './app/webhook-service';
export * from './app/credential-providers/fixture-credentials';
export * from './app/adapters/simulated-channel-adapter';
export * from './app/adapters/emulated-http-adapter';
export * from './projections/projection';
export * from './fixtures';
