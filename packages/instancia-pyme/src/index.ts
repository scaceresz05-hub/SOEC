/**
 * @soec/instancia-pyme — Primer dominio real (F1-RM-01).
 *
 * Instanciación de una pyme de servicios sintética sobre el sistema existente
 * (MED+MDM → ECE → capacidad «Comprender el estado»), conforme a
 * docs/decisions/instanciacion-estrategica-primer-dominio.md (#17 §5). No
 * introduce arquitectura, no ejecuta efectos externos, no usa datos reales:
 * es contenido de instanciación sobre el marco extensible ya congelado.
 */
export * from './dominio';
export * from './capacidad';
export * from './instanciar';
