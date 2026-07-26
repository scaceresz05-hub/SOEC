/**
 * @soec/decision — Decisión institucional gobernada (F2-DISC-01, Paso 4).
 *
 * Motor de GOBIERNO (no el objetivo operativo de marketing): administra elegir /
 * rechazar / reemplazar / revocar una decisión sobre una PROPUESTA del motor de
 * Estrategia, de forma append-only, versionada, justificada y auditable, congelando
 * la propuesta completa. Decidir ≠ ejecutar: no produce efecto operativo. Agregado por
 * Organización + Departamento; a lo sumo un objetivo vigente por par. La capa `pg`
 * (persistencia durable + proyección) vive en el subpath `@soec/decision/pg`.
 */
export * from './domain/decision';
export * from './domain/errors';
export * from './app/decision-service';
export * from './projections/projection';
