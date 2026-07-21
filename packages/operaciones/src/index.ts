/**
 * @soec/operaciones — Sistema de Operaciones Intelectuales ejecutable.
 *
 * Realiza el Documento #13: las cuatro operaciones (esclarecer, detectar,
 * proyectar, orientar) operan SOBRE el ECE (nunca sobre la realidad ni sobre las
 * tablas de MED/MDM/ECE), producen productos intelectuales atribuibles y NO
 * vinculantes, declaran incertidumbre y limitaciones, preservan lo faltante y
 * pueden abstenerse. Tras una frontera de mecanismo sustituible (determinístico /
 * IA simulada). No implementa capacidades ni incorpora un proveedor real de IA.
 */
export * from './domain/product';
export * from './domain/mechanism';
export * from './domain/aggregate';
export * from './domain/errors';
export * from './app/operations-service';
export * from './app/operations-port';
export * from './app/mechanisms/deterministic';
export * from './app/mechanisms/simulated';
export * from './projections/projection';
