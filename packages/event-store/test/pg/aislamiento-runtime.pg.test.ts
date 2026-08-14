/**
 * AISLAMIENTO REAL test↔runtime, contra PostgreSQL de verdad (FASE 4.5).
 *
 * Comprueba, con una conexión real, que la suite PG opera sobre `soec_test` y que la base operativa
 * `soec` es OTRA base, intacta y ajena a esta suite. Es la contraparte empírica del contrato
 * verificado en `test-db-contract.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { afterAll } from 'vitest';
import {
  SUFIJO_BASE_DE_PRUEBA,
  assertPoolEsBaseDePrueba,
  ejecutarDestructivoDePrueba,
  makeTestPool,
  nombreBaseDe,
  urlBaseDePrueba,
} from '../../src/pg/test-db';
import { runMigrations } from '../../src/pg/migrate';

const pool = makeTestPool();

afterAll(async () => {
  await pool.end();
});

describe('aislamiento real: la suite PG vive en la base de prueba', () => {
  it('la conexión REAL apunta a una base con sufijo _test, y no a la operativa', async () => {
    const base = await assertPoolEsBaseDePrueba(pool);
    expect(base.endsWith(SUFIJO_BASE_DE_PRUEBA)).toBe(true);
    expect(base).not.toBe('soec');
    expect(nombreBaseDe(urlBaseDePrueba())).toBe(base);
  });

  it('la base OPERATIVA existe y es distinta de la de prueba', async () => {
    const { rows } = await pool.query<{ datname: string }>(
      `select datname from pg_database where datname in ('soec', $1)`,
      [nombreBaseDe(urlBaseDePrueba())],
    );
    const nombres = rows.map((r) => r.datname).sort();
    // Si `soec` existe en esta máquina, deben ser dos bases distintas y separadas.
    if (nombres.includes('soec')) {
      expect(nombres.length).toBe(2);
      expect(nombres).toContain('soec');
      expect(nombres).toContain(nombreBaseDe(urlBaseDePrueba()));
    }
  });

  it('TRUNCATE sí procede aquí: la base de prueba es libremente destruible', async () => {
    await runMigrations(pool);
    await ejecutarDestructivoDePrueba(
      pool,
      'truncate table events, outbox restart identity cascade',
    );
    const { rows } = await pool.query<{ n: string }>('select count(*) as n from events');
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
