/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA Y PLANIFICACIÓN · frontera pública del módulo.
 *
 * `negocio preparado → investigación con evidencia → hallazgos → veredicto por canal → plan en borrador`.
 * Ningún paso publica nada: el final de esta cadena es una propuesta versionada y explicable.
 */
export * from './investigacion-tipos';
export * from './proveedores';
export * from './investigacion-pg';
export * from './intencion';
export * from './analisis';
export * from './sitio-auditoria';
export * from './google-providers';
export * from './investigacion-service';
export {
  planMigrations,
  RepositorioPlan,
  type ExplicacionPlan,
  type GrupoDelPlan,
  type NegativaDelPlan,
  type PalabraDelPlan,
  type PlanCampania,
  type PropuestaPresupuesto,
  type PropuestaPuja,
  type EstructuraPropuesta,
} from './plan-pg';
export * from './planificador';
export { PlanService, SinInvestigacionError, type DepsPlan, type VistaPlan } from './plan-service';
export * from './composicion';
export * from './investigacion-routes';
