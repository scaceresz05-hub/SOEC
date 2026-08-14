import { defineConfig } from 'vitest/config';
import { PATRONES_PRUEBAS_PG } from './vitest.shared';

/**
 * Suite de POSTGRESQL: sólo las pruebas que abren una base real y pueden truncarla.
 *
 * Opera EXCLUSIVAMENTE sobre la base de prueba (`*_test`), garantizado en tres capas:
 *   1. `makeTestPool()` nunca lee `DATABASE_URL`;
 *   2. `assertSafeTestDatabase` valida NODE_ENV, host y sufijo del nombre antes de conectar;
 *   3. `ejecutarDestructivoDePrueba` revalida `current_database()` antes de cada TRUNCATE.
 * Se ejecutan en serie porque comparten esa base.
 */
export default defineConfig({
  test: {
    include: PATRONES_PRUEBAS_PG,
    env: { NODE_ENV: 'test' },
    globalSetup: ['./vitest.global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
  },
});
