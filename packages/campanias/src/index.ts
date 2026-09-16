/**
 * @soec/campanias — Campañas gobernadas (Bloque C del Director de Marketing Autónomo V1).
 * Una campaña siempre referencia una decisión de marketing de la misma organización. Puede nacer
 * lista para ejecutarse (decisión aprobada + presupuesto) o como BORRADOR sin presupuesto; en ambos
 * casos, entrar en un estado ejecutable exige presupuesto > 0 y decisión aprobada.
 */
export * from './domain/campania';
export * from './domain/alcance';
export * from './domain/errors';
export * from './app/campania-service';
