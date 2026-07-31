/**
 * @soec/crm-comercial — Cerebro comercial / CRM inteligente (Macrobloque 2, ADR 0018).
 *
 * Memoria estratégica del Director de Marketing Autónomo: contactos individuales con scoring
 * multidimensional EXPLICABLE y recomendaciones fundamentadas (nunca "recomiendo X" a secas; siempre
 * razones + evidencia + alternativas descartadas + confianza + qué falta, o una ABSTENCIÓN honesta).
 * Event-sourced y multi-tenant. Reutiliza el vocabulario epistémico de `@soec/negocio`. No ejecuta
 * nada real (sin canales, gasto ni integraciones externas).
 */
export * from './domain/explicabilidad';
export * from './domain/contacto';
export * from './domain/indices';
export * from './domain/puntaje';
export * from './domain/perfiles';
export * from './domain/errors';
export * from './app/crm-service';
export * from './app/conocimiento-service';
