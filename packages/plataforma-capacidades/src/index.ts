/**
 * @soec/plataforma-capacidades — Núcleo de la Plataforma de Capacidades Externas (PCE), M4-A.
 * Implementa el Título I de la Directiva Maestra PCE: registro y ciclo de vida gobernado de capacidades
 * externas (Capacidad ≠ Activación; secretos/proveedor/costo fuera del dominio; degradación, salud,
 * versión y modo simulado/real), event-sourced, multi-tenant, determinista y NEUTRAL (sin SDKs/red/env).
 */
export * from './domain/capacidad';
export * from './domain/indice';
export * from './domain/errors';
export * from './app/capacidades-service';
