/**
 * @soec/contenido — Fábrica Autónoma de Contenido Multicanal (F2-CONT-01).
 *
 * Transforma una actividad de marketing bloqueada por falta de contenido en un
 * PAQUETE PUBLICABLE versionado: brief → pieza fuente → adaptaciones por canal →
 * activos → validación → revisión automática → paquete. Entrega el paquete listo a
 * la actividad por el contrato público de marketing (la transiciona a autorizable);
 * la ejecución sigue pasando por el plano operacional (SIMULADA). La fábrica no
 * publica, no se autoriza, no accede a SDK de canales ni gasta presupuesto real.
 * El proveedor generativo es un puerto reemplazable con un proveedor determinista
 * por defecto (fixture, no "IA real"). Datos sintéticos; ningún efecto externo real.
 */
export * from './domain/afirmacion';
export * from './domain/marca';
export * from './domain/brief';
export * from './domain/pieza';
export * from './domain/adaptacion';
export * from './domain/activo';
export * from './domain/canales';
export * from './domain/generative';
export * from './domain/prompts';
export * from './domain/validacion';
export * from './domain/revision';
export * from './domain/paquete';
export * from './domain/errors';
export * from './app/marca-service';
export * from './app/prompt-service';
export * from './app/brief-service';
export * from './app/factory-service';
export * from './app/content-service';
export * from './providers/deterministic';
export * from './projections/projection';
export * from './fixtures';
