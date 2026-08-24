import { defineConfig } from 'vitest/config';
import { PATRONES_PRUEBAS_PG, PATRONES_TODAS } from './vitest.shared';

/**
 * Suite de UNIDAD: todo lo que NO abre PostgreSQL. No puede ejecutar ninguna sentencia destructiva
 * porque excluye, por convención de nombre, toda suite capaz de abrir un pool real.
 * No necesita base de datos alguna.
 */
export default defineConfig({
  // JSX con runtime AUTOMÁTICO (igual que Next): los componentes no importan React. Sólo afecta la
  // transformación de archivos JSX/TSX en pruebas (los componentes web probados con RTL).
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: PATRONES_TODAS,
    exclude: ['**/node_modules/**', '**/dist/**', ...PATRONES_PRUEBAS_PG],
    env: { NODE_ENV: 'test' },
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
