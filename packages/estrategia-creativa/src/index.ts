/**
 * @soec/estrategia-creativa — Conexión del cerebro comercial con el motor de generación (Macrobloque 3,
 * ADR 0019). Deriva, de forma determinista y EVALUABLE, un brief comercial y una estrategia creativa
 * (concepto/ángulo/gancho/mensajes/tono) desde el conocimiento comercial (`@soec/crm-comercial`), para
 * alimentar el pipeline existente (marketing/contenido/campañas). Neutral (sin proveedores externos),
 * multi-tenant y sin efectos: produce insumos/borradores, nunca publica ni gasta.
 */
export * from './domain/estrategia-creativa';
export * from './domain/conexion';
export * from './domain/variantes-ab';
export * from './domain/calendario';
export * from './domain/errors';
export * from './app/estrategia-creativa-service';
export * from './app/variantes-ab-service';
export * from './app/calendario-service';
