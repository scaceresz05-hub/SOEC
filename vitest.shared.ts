/**
 * Convención ÚNICA que separa las pruebas que tocan PostgreSQL de las que no.
 *
 * Una prueba que abre un pool real (y por tanto puede truncar tablas) DEBE llamarse `*.pg.test.ts`
 * o vivir bajo `test/pg/`. La regla es mecánica y está verificada por
 * `packages/event-store/test/test-db-contract.test.ts`: cualquier archivo que importe
 * `@soec/event-store/test-db` y no cumpla la convención hace fallar la suite.
 *
 * Así, `test:unit` no puede ejecutar por accidente una suite destructiva, y `test:pg` no puede
 * olvidarse de ninguna.
 */
export const PATRONES_PRUEBAS_PG = ['**/*.pg.test.ts', '**/test/pg/**/*.test.ts'];

export const PATRONES_TODAS = ['packages/**/*.test.ts', 'apps/**/*.test.ts'];

/** ¿La ruta cumple la convención de prueba con PostgreSQL? */
export function esPruebaPg(ruta: string): boolean {
  const p = ruta.replace(/\\/g, '/');
  return p.endsWith('.pg.test.ts') || p.includes('/test/pg/');
}
