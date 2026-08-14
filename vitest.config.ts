import { defineConfig } from 'vitest/config';
import { PATRONES_TODAS } from './vitest.shared';

/**
 * Configuración BASE (suite completa: unidad + PostgreSQL).
 *
 * Las suites PG resuelven su conexión por `@soec/event-store/test-db`, que apunta SIEMPRE a una base
 * `*_test` y nunca lee `DATABASE_URL`. Por eso ejecutar la suite completa ya no puede truncar la base
 * operativa. `NODE_ENV=test` se fija explícitamente: la guarda destructiva lo exige.
 */
export default defineConfig({
  test: {
    include: PATRONES_TODAS,
    env: { NODE_ENV: 'test' },
    globalSetup: ['./vitest.global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    // Las suites PG comparten la misma base de PRUEBA; se ejecutan en serie para evitar
    // contención entre ellas (truncados cruzados).
    fileParallelism: false,
  },
});
