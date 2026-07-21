import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    // Los archivos de prueba con PostgreSQL real comparten la misma base;
    // se ejecutan en serie para evitar contención entre suites (truncados cruzados).
    fileParallelism: false,
  },
});
