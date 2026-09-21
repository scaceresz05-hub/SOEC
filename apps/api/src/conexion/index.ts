/**
 * apps/api · CONEXIONES COMO DATO · frontera pública del módulo.
 *
 * `negocio → conexiones → capacidades → runtime`. Sin secretos: sólo referencias opacas.
 */
export * from './conexion-tipos';
export * from './conexion-pg';
export * from './secreto-conexion';
export * from './proyeccion';
export * from './conexion-service';
export * from './conexion-routes';
export * from './migracion-conexiones';
export * from './snapshot';
