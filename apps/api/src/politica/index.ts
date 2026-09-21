/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · frontera pública del módulo.
 *
 * `negocio → política de evaluación → perfil evaluable → decisión`. La decisión sigue sin autorizar gasto:
 * eso lo gobierna `business_governance` y el mandato financiero.
 */
export * from './politica-tipos';
export * from './politica-pg';
export * from './politica-perfil';
export * from './politica-service';
export * from './politica-routes';
export * from './migracion-politica';
