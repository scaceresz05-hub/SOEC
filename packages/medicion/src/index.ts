/**
 * @soec/medicion — Medición, Atribución y Optimización Autónoma (F2-MET-01).
 *
 * Cierra el lazo del Departamento de Marketing Autónomo: ingesta métricas de una fuente
 * proveedor-independiente, las normaliza y deduplica (conservando correcciones), evalúa
 * la calidad de la evidencia, calcula indicadores DETERMINISTAS, atribuye con cautela
 * (observación ╪ atribución ╪ inferencia; nunca causalidad sin mecanismo), detecta
 * anomalías, evalúa el objetivo y PROPONE optimizaciones. Toda decisión con efecto pasa
 * por el motor de autorización y se aplica como cambio VERSIONADO del plan. El módulo no
 * publica, no gasta, no modifica planes en silencio ni aumenta su propia autonomía.
 */
export * from './domain/vocabulary';
export * from './domain/metrics';
export * from './domain/quality';
export * from './domain/indicator';
export * from './domain/attribution';
export * from './domain/resultado-campania';
export * from './domain/evaluation';
export * from './domain/anomaly';
export * from './domain/med';
export * from './domain/optimization';
export * from './domain/experiment';
export * from './domain/errors';
export * from './app/metrics-source';
export * from './app/measurement-service';
export * from './app/optimization-service';
export * from './projections/projection';
export * from './fixtures';
