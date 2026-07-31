/**
 * @soec/programas — Configuración de Programas de Marketing por Negocio.
 *
 * Extiende el Director Autónomo V1 para que opere sobre un negocio CONCRETO configurado
 * (objetivos, segmentos, hipótesis, N campañas, N contenidos, presupuesto simulado) en lugar de
 * una fixture fija. COMPONE los servicios A–J (no los duplica), enumera con índices y reconstruye
 * por ids scopeados por programa. Ejecución y ROI estrictamente SIMULADOS. Ver ADR-004.
 */
export * from './domain/negocio';
export * from './domain/programa';
export * from './domain/indices';
export * from './domain/errors';
export * from './app/negocio-service';
export * from './app/programa-service';
export * from './app/vista-programa';
export * from './app/ciclo-programa-service';
