/**
 * @soec/control — Centro de Control del Departamento Autónomo (F2-CTRL-01).
 *
 * Reúne el gobierno y la supervisión del departamento: salud determinista por
 * precedencia, interruptor maestro de PAUSA (real, integrado con el plano operacional),
 * bandeja de DECISIONES excepcionales (aprobar/denegar/modificar con permisos por rol),
 * ALERTAS deduplicadas y notificaciones internas, y los tipos del modelo de lectura
 * integrado. El modelo de lectura se COMPONE en la capa de aplicación a partir de
 * contratos públicos y proyecciones; no recalcula indicadores ni es otra fuente de
 * verdad. No modifica agregados de otros módulos ni salta la autorización. Modo real
 * desactivado; ningún efecto/gasto público real.
 */
export * from './domain/health';
export * from './domain/pausa';
export * from './domain/decision';
export * from './domain/inbox';
export * from './domain/catalogo-base';
export * from './domain/roles';
export * from './domain/summary';
export * from './domain/errors';
export * from './app/pausa-service';
export * from './app/decision-service';
export * from './app/inbox-service';
export * from './projections/projection';
