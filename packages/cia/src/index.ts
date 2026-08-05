/**
 * @soec/cia — Centro de Integraciones Autónomas (CIA) · CAPA DE PRODUCTO sobre la Plataforma de Capacidades
 * Externas (PCE: `@soec/plataforma-capacidades`, `@soec/secretos`, `@soec/adaptadores`, `@soec/canales`).
 *
 * CIA NO reconstruye infraestructura de integración: la REUTILIZA. Aporta la frontera de PRODUCTO que hacía
 * falta para que el Director de Marketing autónomo pueda actuar sobre el mundo SIN cambiar la experiencia:
 *  - Catálogo de capacidades como RESULTADOS autorizables (no herramientas).
 *  - Autorización humana de una capacidad con límite y nivel de autonomía (reusa la semántica de M4-D).
 *  - Planificador que elige el proveedor DETRÁS de la frontera y respeta kill-switch, límite y autonomía.
 *  - Kill-switch por organización y por capacidad.
 *  - Lectura capability-framed para HOME / Decisiones / Por qué, con garantía de NO fuga de proveedor.
 *
 * PREPARACIÓN CERRADA: todo es SIMULADO y determinista. `AUTONOMOUS_REAL` bloqueado. Sin SDKs, red, OAuth,
 * credenciales, gasto, publicación ni envío. El modo REAL exige cuatro puertas: validación externa suficiente,
 * Directiva M4-D ratificada, decisiones D-1…D-7 y aprobación expresa del primer piloto.
 *
 * Principio rector: el usuario AUTORIZA CAPACIDADES; SOEC decide qué herramienta usar detrás de la frontera;
 * conectar una integración no crea módulos ni cambia los flujos del usuario.
 */
export * from './dominio/errors';
export * from './dominio/guardarrailes';
export * from './dominio/catalogo';
export * from './dominio/autorizacion';
export * from './dominio/kill-switch';
export * from './dominio/plan';
export * from './app/catalogo-service';
export * from './app/autorizaciones-service';
export * from './app/kill-switch-service';
export * from './app/planificador-service';
export * from './app/lectura-integraciones-service';
