/**
 * CONTRATO DE BASE DE PRUEBA — pruebas adversariales (FASE 4.5).
 *
 * Incidente que las motiva: las suites PG resolvían su conexión con
 * `process.env.DATABASE_URL ?? '…/soec'` y ejecutaban `TRUNCATE TABLE events … CASCADE`, truncando
 * la base OPERATIVA. Aquí se verifica que ese camino ya no exista, en tres planos:
 *
 *   1. contrato de la URL (nombre, host, NODE_ENV) — sin fallback al runtime;
 *   2. guarda en el momento del destrozo — se revalida contra la base REALMENTE conectada;
 *   3. arquitectura del repositorio — ninguna suite puede reintroducir el patrón.
 *
 * Ninguna prueba de este archivo abre una conexión: la guarda se ejercita con pools falsos que
 * REGISTRAN si la sentencia destructiva llegó a emitirse. Si la guarda fallara, se vería aquí sin
 * haber tocado ninguna base real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import {
  BaseDePruebaInseguraError,
  SUFIJO_BASE_DE_PRUEBA,
  URL_BASE_DE_PRUEBA_POR_DEFECTO,
  VAR_URL_BASE_DE_PRUEBA,
  asegurarBaseDePrueba,
  assertPoolEsBaseDePrueba,
  assertSafeTestDatabase,
  ejecutarDestructivoDePrueba,
  esBaseDePruebaSegura,
  makeTestPool,
  nombreBaseDe,
  urlBaseDePrueba,
} from '../src/pg/test-db';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_TEST = { NODE_ENV: 'test' } as const;

const URL_RUNTIME = 'postgres://soec:soec@localhost:5544/soec';
const URL_TEST = 'postgres://soec:soec@localhost:5544/soec_test';

/** Pool falso: responde `current_database()` y REGISTRA cualquier sentencia emitida. */
function poolFalso(base: string) {
  const emitidas: string[] = [];
  return {
    emitidas,
    query: async (sql: string) => {
      emitidas.push(sql);
      if (/current_database/i.test(sql)) return { rows: [{ db: base }] };
      return { rows: [] };
    },
  } as never;
}

/** Recorre el repositorio devolviendo rutas relativas de archivos `.ts`. */
function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (
      entrada === 'node_modules' ||
      entrada === '.git' ||
      entrada === 'dist' ||
      entrada === '.next'
    )
      continue;
    const ruta = resolve(dir, entrada);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acc);
    else if (entrada.endsWith('.ts') || entrada.endsWith('.tsx'))
      acc.push(relative(RAIZ, ruta).replace(/\\/g, '/'));
  }
  return acc;
}

/**
 * Este mismo archivo queda fuera del escaneo: nombra los patrones prohibidos (`DATABASE_URL`, la
 * ruta del contrato) precisamente para poder prohibirlos. No abre ninguna conexión.
 */
const ESTE_ARCHIVO = 'packages/event-store/test/test-db-contract.test.ts';
const TODOS = archivosTs(resolve(RAIZ, 'packages'))
  .concat(archivosTs(resolve(RAIZ, 'apps')))
  .filter((p) => p !== ESTE_ARCHIVO);
const esPruebaPg = (p: string): boolean => p.endsWith('.pg.test.ts') || p.includes('/test/pg/');
const esPrueba = (p: string): boolean => p.includes('/test/') || p.endsWith('.test.ts');
const leer = (p: string): string => readFileSync(resolve(RAIZ, p), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONTRATO DE LA URL
// ─────────────────────────────────────────────────────────────────────────────
describe('CONTRATO · qué base acepta como base de prueba', () => {
  it('TEST_DB_ACCEPTS_SOEC_TEST — una base con sufijo _test en host local es válida', () => {
    expect(assertSafeTestDatabase(URL_TEST, ENV_TEST)).toBe('soec_test');
    expect(esBaseDePruebaSegura(URL_TEST, ENV_TEST)).toBe(true);
    expect(nombreBaseDe(URL_TEST).endsWith(SUFIJO_BASE_DE_PRUEBA)).toBe(true);
  });

  it('TEST_DB_REJECTS_SOEC — la base OPERATIVA se rechaza siempre', () => {
    expect(() => assertSafeTestDatabase(URL_RUNTIME, ENV_TEST)).toThrow(BaseDePruebaInseguraError);
    expect(esBaseDePruebaSegura(URL_RUNTIME, ENV_TEST)).toBe(false);
    // También sus variantes por si alguien "casi" acierta.
    for (const url of [
      'postgres://soec:soec@localhost:5544/soec',
      'postgres://soec:soec@localhost:5544/postgres',
      'postgres://u:p@localhost:5432/soec_prod',
      'postgres://u:p@localhost:5432/production',
      'postgres://u:p@localhost:5432/testing', // "testing" no es el sufijo _test
    ]) {
      expect(esBaseDePruebaSegura(url, ENV_TEST)).toBe(false);
    }
  });

  it('TEST_DB_REJECTS_PRODUCTION_URL — proveedores gestionados y hosts remotos', () => {
    // Railway y compañía: prohibidos SIEMPRE, incluso con el opt-in remoto.
    for (const url of [
      'postgres://u:p@containers-us-west-1.railway.app:6543/soec_test',
      'postgres://u:p@monorail.proxy.rlwy.net:1234/soec_test',
      'postgres://u:p@db.abcdef.supabase.co:5432/soec_test',
      'postgres://u:p@ep-cool.neon.tech/soec_test',
      'postgres://u:p@x.rds.amazonaws.com:5432/soec_test',
    ]) {
      expect(esBaseDePruebaSegura(url, ENV_TEST)).toBe(false);
      expect(esBaseDePruebaSegura(url, { ...ENV_TEST, SOEC_TEST_DB_ALLOW_REMOTE: 'true' })).toBe(
        false,
      );
    }
    // Un host remoto cualquiera exige opt-in explícito.
    const remoto = 'postgres://u:p@db.interno.example:5432/soec_test';
    expect(esBaseDePruebaSegura(remoto, ENV_TEST)).toBe(false);
    expect(esBaseDePruebaSegura(remoto, { ...ENV_TEST, SOEC_TEST_DB_ALLOW_REMOTE: 'true' })).toBe(
      true,
    );
  });

  it('fuera de NODE_ENV=test nada es una base de prueba válida', () => {
    expect(esBaseDePruebaSegura(URL_TEST, { NODE_ENV: 'production' })).toBe(false);
    expect(esBaseDePruebaSegura(URL_TEST, { NODE_ENV: 'development' })).toBe(false);
    expect(esBaseDePruebaSegura(URL_TEST, {})).toBe(false);
  });

  it('una URL ausente o ilegible se rechaza (no hay default implícito hacia el runtime)', () => {
    expect(() => assertSafeTestDatabase(undefined, ENV_TEST)).toThrow(BaseDePruebaInseguraError);
    expect(() => assertSafeTestDatabase('', ENV_TEST)).toThrow(BaseDePruebaInseguraError);
    expect(() => assertSafeTestDatabase('no-es-una-url', ENV_TEST)).toThrow(
      BaseDePruebaInseguraError,
    );
    expect(() => assertSafeTestDatabase('postgres://u:p@localhost:5432', ENV_TEST)).toThrow(
      BaseDePruebaInseguraError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RESOLUCIÓN — sin fallback al runtime
// ─────────────────────────────────────────────────────────────────────────────
describe('RESOLUCIÓN · la base de prueba nunca hereda la del runtime', () => {
  it('PG_TEST_SUITE_CANNOT_USE_RUNTIME_FALLBACK — DATABASE_URL se ignora por completo', () => {
    // Aunque DATABASE_URL apunte a la base operativa, la resolución de prueba no la mira.
    const env = { ...ENV_TEST, DATABASE_URL: URL_RUNTIME };
    expect(urlBaseDePrueba(env)).toBe(URL_BASE_DE_PRUEBA_POR_DEFECTO);
    expect(nombreBaseDe(urlBaseDePrueba(env))).toBe('soec_test');

    // Y si alguien apunta la variable DE PRUEBA a la base operativa, se aborta.
    expect(() => urlBaseDePrueba({ ...ENV_TEST, [VAR_URL_BASE_DE_PRUEBA]: URL_RUNTIME })).toThrow(
      BaseDePruebaInseguraError,
    );
    expect(() => makeTestPool({ ...ENV_TEST, [VAR_URL_BASE_DE_PRUEBA]: URL_RUNTIME })).toThrow(
      BaseDePruebaInseguraError,
    );
  });

  it('el default local apunta a una base _test, no a la operativa', () => {
    expect(URL_BASE_DE_PRUEBA_POR_DEFECTO).toContain('/soec_test');
    expect(nombreBaseDe(URL_BASE_DE_PRUEBA_POR_DEFECTO)).not.toBe('soec');
  });

  it('asegurarBaseDePrueba jamás podría recrear la base operativa', async () => {
    await expect(
      asegurarBaseDePrueba({ ...ENV_TEST, [VAR_URL_BASE_DE_PRUEBA]: URL_RUNTIME }),
    ).rejects.toThrow(BaseDePruebaInseguraError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GUARDA EN EL MOMENTO DEL DESTROZO
// ─────────────────────────────────────────────────────────────────────────────
describe('GUARDA · ninguna sentencia destructiva llega a una base operativa', () => {
  it('PG_TRUNCATE_GUARD_REJECTS_RUNTIME — con un pool conectado a `soec`, el TRUNCATE no se emite', async () => {
    const pool = poolFalso('soec');
    await expect(
      ejecutarDestructivoDePrueba(pool, 'truncate table events, outbox restart identity cascade'),
    ).rejects.toThrow(BaseDePruebaInseguraError);
    // La prueba decisiva: sólo se preguntó por la base; el TRUNCATE NUNCA se emitió.
    const emitidas = (pool as unknown as { emitidas: string[] }).emitidas;
    expect(emitidas.some((s) => /current_database/i.test(s))).toBe(true);
    expect(emitidas.some((s) => /truncate/i.test(s))).toBe(false);
  });

  it('con un pool conectado a `soec_test`, el TRUNCATE sí se emite', async () => {
    const pool = poolFalso('soec_test');
    await ejecutarDestructivoDePrueba(pool, 'truncate table events restart identity cascade');
    const emitidas = (pool as unknown as { emitidas: string[] }).emitidas;
    expect(emitidas.some((s) => /truncate/i.test(s))).toBe(true);
  });

  it('la guarda no confía en la cadena de conexión, sino en la base REALMENTE conectada', async () => {
    // Un pool que "dice" ser de prueba por su URL pero está conectado a la operativa: se rechaza.
    await expect(assertPoolEsBaseDePrueba(poolFalso('soec'))).rejects.toThrow(
      BaseDePruebaInseguraError,
    );
    await expect(assertPoolEsBaseDePrueba(poolFalso('postgres'))).rejects.toThrow(
      BaseDePruebaInseguraError,
    );
    await expect(assertPoolEsBaseDePrueba(poolFalso('soec_test'))).resolves.toBe('soec_test');
  });

  it('sólo admite sentencias destructivas (no es un `query` genérico disfrazado)', async () => {
    await expect(ejecutarDestructivoDePrueba(poolFalso('soec_test'), 'select 1')).rejects.toThrow(
      BaseDePruebaInseguraError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ARQUITECTURA — el patrón peligroso no puede reintroducirse
// ─────────────────────────────────────────────────────────────────────────────
describe('ARQUITECTURA · el repositorio no puede volver al patrón peligroso', () => {
  it('ninguna prueba lee DATABASE_URL (el fallback al runtime está erradicado)', () => {
    const culpables = TODOS.filter(
      (p) => esPrueba(p) && leer(p).includes('process.env.DATABASE_URL'),
    );
    expect(culpables).toEqual([]);
  });

  it('ninguna prueba llama a `pool.query` con un TRUNCATE sin pasar por la guarda', () => {
    const culpables = TODOS.filter(
      (p) => esPrueba(p) && /pool\.query\(\s*[`'"]\s*truncate/i.test(leer(p)),
    );
    expect(culpables).toEqual([]);
  });

  it('toda prueba que abre PostgreSQL cumple la convención de nombre `*.pg.test.ts` o `test/pg/`', () => {
    const conPool = TODOS.filter((p) => leer(p).includes('@soec/event-store/test-db'));
    expect(conPool.length).toBeGreaterThan(20); // la migración cubrió toda la superficie PG
    const fueraDeConvencion = conPool.filter((p) => !esPruebaPg(p) && esPrueba(p));
    expect(fueraDeConvencion).toEqual([]);
  });

  it('el contrato de prueba NO es alcanzable desde código de producción', () => {
    const produccion = TODOS.filter((p) => p.includes('/src/') && !p.endsWith('test-db.ts'));
    const culpables = produccion.filter((p) => leer(p).includes('event-store/test-db'));
    expect(culpables).toEqual([]);
  });

  it('la suite de unidad excluye por configuración toda prueba con PostgreSQL', () => {
    const unit = readFileSync(resolve(RAIZ, 'vitest.unit.config.ts'), 'utf8');
    const compartido = readFileSync(resolve(RAIZ, 'vitest.shared.ts'), 'utf8');
    expect(unit).toContain('PATRONES_PRUEBAS_PG');
    expect(unit).toContain('exclude');
    expect(compartido).toContain('*.pg.test.ts');
    expect(compartido).toContain('test/pg/');
  });
});
