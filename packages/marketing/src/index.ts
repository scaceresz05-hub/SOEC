/**
 * @soec/marketing — Modelo Operativo y Planificador Autónomo de Marketing (F2-MKT-01).
 *
 * Representa el trabajo real de un departamento de marketing (objetivo → plan
 * versionado → iniciativas → campañas → actividades → calendario → presupuesto) y
 * lo planifica de forma DETERMINÍSTICA y auditable. El planificador PROPONE; el
 * plano operacional (@soec/operacional) AUTORIZA y ejecuta (simulado). El
 * planificador no publica, no accede a adaptadores, no salta la autorización ni
 * crea efectos. Datos sintéticos; ningún efecto externo real.
 */
export * from './domain/objetivo';
export * from './domain/plan';
export * from './domain/planner';
export * from './domain/errors';
export * from './app/objective-service';
export * from './app/planning-service';
export * from './projections/projection';
export * from './fixtures';
