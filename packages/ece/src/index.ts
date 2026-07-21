/**
 * @soec/ece — Estado Cognitivo Empresarial ejecutable.
 *
 * Representación derivada, persistente, histórica, atribuible y verificable que
 * integra MED y MDM (#12): hace visibles coherencias, contradicciones, ausencias,
 * dependencias y brechas, sin fusionar los modelos, sin inventar información, sin
 * resolver contradicciones y sin cerrar el lazo humano. No implementa operaciones
 * intelectuales ni capacidades: deja un puerto de lectura estable para el #13.
 */
export * from './domain/ece';
export * from './domain/derive';
export * from './domain/errors';
export * from './app/build-service';
export * from './app/read-port';
export * from './projections/projection';
