/**
 * @soec/motor-optimizacion — M9 · Motor de Optimización Continua Gobernada.
 *
 * Cierra el ciclo funcional de SOEC (M5 conoce · M6 diseña · M7 opera · M8 aprende · M9 optimiza), EN MODO
 * EXCLUSIVAMENTE SIMULADO. M9 NO ejecuta: decide QUÉ convendría cambiar y prepara una NUEVA versión del plan
 * para APROBACIÓN HUMANA. Una recomendación no es una orden; un aprendizaje no autoriza automáticamente; una
 * mejora simulada no es evidencia real. Conserva trazabilidad, evidencia, incertidumbre, reversibilidad
 * lógica, aprobación humana, aislamiento organizacional y capacidad de abstención. `AUTONOMOUS_REAL`
 * bloqueado. Reutiliza los 4 puertos de lectura (M5–M8), la aprobación canónica, el presupuesto y las
 * escrituras canónicas de cada macrobloque; no crea máquinas paralelas.
 */
export * from './dominio/optimizacion-tipos';
export * from './dominio/comparacion';
export * from './dominio/ciclo';
export * from './dominio/propuesta';
export * from './dominio/politica-oscilacion';
export * from './dominio/errors';
export * from './contratos';
export * from './app/optimizacion-service';
export * from './app/propuesta-service';
export * from './app/memoria-decisiones-service';
export * from './app/reconciliador-optimizacion-service';
export * from './app/lectura-ciclo-soec-service';
