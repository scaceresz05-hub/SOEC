/**
 * @soec/motor-estrategico — Motor Estratégico Comercial (M5).
 *
 * PRODUCTOR del conocimiento estratégico de SOEC. Dos capas:
 *  1) NÚCLEO epistémico canónico: los cuatro estados de evaluabilidad (VERDADERO/FALSO/GRIS/NO_EVALUABLE)
 *     y el motor puro `evaluar()` que recorre SSOT → Evaluabilidad → Pertinencia → Suficiencia → Confianza.
 *  2) DOMINIO estratégico: la Afirmación Estratégica evaluable, event-sourced y multi-tenant, que
 *     generaliza el patrón de la hipótesis a toda entidad del Bloque Maestro y enlaza (sin duplicar) los
 *     SSOT existentes (`@soec/negocio`, `@soec/crm-comercial`, hipótesis).
 *
 * Los consumidores (M6–M9) dependen del puerto `LecturaConocimiento`; la escritura queda separada.
 */

// Núcleo epistémico canónico
export * from './nucleo/estado';
export * from './nucleo/evidencia';
export * from './nucleo/evaluar';

// Dominio estratégico
export * from './dominio/afirmacion';
export * from './dominio/indice';
export * from './dominio/errors';

// Contratos (puertos) y servicio
export * from './contratos';
export { MotorEstrategicoService } from './app/motor-estrategico-service';
