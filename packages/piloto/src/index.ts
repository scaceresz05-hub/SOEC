/**
 * @soec/piloto — Preparación del Piloto Operacional Controlado (F2-PILOT-01).
 *
 * Vertical GENÉRICA (no pertenece a marketing) que prepara la operación de una
 * organización para un piloto real: registro de organización, onboarding reanudable,
 * perfil operacional, entornos/modos, conexiones previstas (sin tokens), política inicial
 * conservadora, presupuesto de piloto (gasto real siempre en cero), readiness DETERMINISTA
 * por entorno, expediente versionado, criterios de éxito/suspensión, plan de rollback,
 * ensayo integral y checklist de activación. La CEREMONIA DE ACTIVACIÓN real permanece
 * BLOQUEADA por guardarraíl: la plataforma demuestra que una organización está lista —o
 * explica exactamente por qué no— antes de permitir cualquier efecto real. Sin publicación
 * pública, sin gasto real, sin credenciales reales, sin conexión productiva.
 */
export * from './domain/entorno';
export * from './domain/organizacion';
export * from './domain/readiness';
export * from './domain/politica-inicial';
export * from './domain/expediente';
export * from './domain/ensayo';
export * from './domain/errors';
export * from './app/organizacion-service';
export * from './app/readiness-service';
export * from './app/expediente-service';
export * from './app/ensayo-service';
export * from './projections/projection';
export * from './fixtures';
