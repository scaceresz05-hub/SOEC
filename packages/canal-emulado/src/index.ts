/**
 * @soec/canal-emulado — Proveedor de canal externo EMULADO para F2-CHAN-01.
 *
 * Servicio de desarrollo AISLADO (sin dependencias @soec/*) que emula un proveedor
 * real (HTTP, autenticación, identificadores externos, estados, idempotencia, rate
 * limiting, borrado, webhooks y escenarios de fallo). Valida la frontera de red del
 * adaptador. Nunca publica en una plataforma pública real.
 */
export * from './emulador';
