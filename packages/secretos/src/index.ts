/**
 * @soec/secretos — SecretStore por referencia (M4-B de la Directiva PCE). El dominio conoce Capacidades y
 * REFERENCIAS, nunca secretos: la gobernanza (`RegistroSecretosService`) sólo maneja metadatos; el valor de
 * un secreto sólo existe dentro del adaptador de frontera (`SecretStore`) y sólo se expone por la caja opaca
 * `SecretoResuelto.usar`. Event-sourced, multi-tenant, determinista, neutral (sin SDKs/red/env/reloj).
 */
export * from './domain/secreto-resuelto';
export * from './domain/registro';
export * from './domain/errors';
export * from './port/secret-store';
export * from './adapters/secret-store-en-memoria';
export * from './app/registro-secretos-service';
