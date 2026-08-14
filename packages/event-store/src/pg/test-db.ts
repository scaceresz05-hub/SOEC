/**
 * @soec/event-store · pg · CONTRATO DE BASE DE DATOS DE PRUEBA.
 *
 * MOTIVO (incidente real, 2026-08-13): las suites PG resolvían su conexión con
 * `process.env.DATABASE_URL ?? 'postgres://…/soec'` y ejecutaban `TRUNCATE TABLE events … CASCADE`.
 * Al correr la suite con el runtime apuntando a la misma base, se truncó la base OPERATIVA y se
 * perdió histórico derivado real.
 *
 * Este módulo hace que ese accidente sea ESTRUCTURALMENTE IMPOSIBLE, no una convención a recordar:
 *
 *  1. **Sin fallback al runtime.** Nunca se lee `DATABASE_URL`. La URL de prueba viene de
 *     `SOEC_TEST_DATABASE_URL` o del default local, que por construcción apunta a `…_test`.
 *  2. **Contrato de nombre.** La base DEBE terminar en `_test`. `soec` se rechaza; `soec_test` pasa.
 *  3. **Sin bases remotas por accidente.** Sólo hosts locales, salvo opt-in explícito
 *     (`SOEC_TEST_DB_ALLOW_REMOTE=true`), y nunca proveedores gestionados conocidos.
 *  4. **Guarda en el momento del destrozo.** Antes de TRUNCATE/DROP/DELETE se vuelve a preguntar a
 *     PostgreSQL `select current_database()` y se re-valida. No se confía en el llamador ni en la
 *     cadena de conexión: se valida contra la base REALMENTE conectada.
 *
 * FAIL-CLOSED en cada punto: ante cualquier duda, aborta antes de conectar o antes de destruir.
 *
 * Este módulo es EXCLUSIVO de las pruebas. Ningún archivo de `src/` de producción debe importarlo
 * (hay una prueba de arquitectura que lo verifica).
 */
import { Pool } from 'pg';

/** Sufijo obligatorio del nombre de la base de datos de prueba. */
export const SUFIJO_BASE_DE_PRUEBA = '_test';

/** Base de prueba local por defecto. Apunta al contenedor `soec_postgres` del compose del repo. */
export const URL_BASE_DE_PRUEBA_POR_DEFECTO = 'postgres://soec:soec@localhost:5544/soec_test';

/** Variable ÚNICA que puede redefinir la base de prueba. `DATABASE_URL` NO se lee jamás aquí. */
export const VAR_URL_BASE_DE_PRUEBA = 'SOEC_TEST_DATABASE_URL';

/** Hosts considerados locales. Cualquier otro exige opt-in explícito. */
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

/** Proveedores gestionados: se rechazan SIEMPRE, incluso con el opt-in remoto. */
const HOSTS_PROHIBIDOS = [
  'railway.app',
  'rlwy.net',
  'render.com',
  'supabase.co',
  'neon.tech',
  'amazonaws.com',
  'azure.com',
  'cloudsql',
  'gcp',
  'planetscale',
  'heroku',
];

/** Nombres de base que nunca pueden usarse en pruebas destructivas, aunque el patrón encajara. */
const BASES_PROHIBIDAS = new Set([
  'soec',
  'postgres',
  'template0',
  'template1',
  'production',
  'prod',
]);

export class BaseDePruebaInseguraError extends Error {
  constructor(motivo: string) {
    super(`base de datos de prueba INSEGURA: ${motivo}`);
    this.name = 'BaseDePruebaInseguraError';
  }
}

/** Extrae el nombre de la base de una URL de conexión PostgreSQL. */
export function nombreBaseDe(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BaseDePruebaInseguraError(`URL de conexión ilegible`);
  }
  const nombre = decodeURIComponent(parsed.pathname.replace(/^\//, '')).trim();
  if (!nombre) throw new BaseDePruebaInseguraError('la URL no declara nombre de base de datos');
  return nombre;
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new BaseDePruebaInseguraError('URL de conexión ilegible');
  }
}

/**
 * Verifica que una URL apunte a una base de datos donde es LÍCITO destruir datos.
 * Devuelve el nombre de la base. Lanza `BaseDePruebaInseguraError` en cualquier otro caso.
 */
export function assertSafeTestDatabase(
  url: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (!url || !url.trim()) {
    throw new BaseDePruebaInseguraError(
      'no se declaró URL de base de prueba (sin fallback al runtime)',
    );
  }

  // (a) Entorno de prueba. Vitest fija NODE_ENV=test; fuera de él, nada destructivo procede.
  if (env.NODE_ENV !== 'test') {
    throw new BaseDePruebaInseguraError(
      `NODE_ENV debe ser 'test' para operar sobre una base de prueba (actual: ${env.NODE_ENV ?? 'sin definir'})`,
    );
  }

  // (b) Host: proveedores gestionados prohibidos SIEMPRE; remotos sólo con opt-in explícito.
  const host = hostDe(url);
  const prohibido = HOSTS_PROHIBIDOS.find((p) => host.includes(p));
  if (prohibido) {
    throw new BaseDePruebaInseguraError(
      `host de proveedor gestionado (${prohibido}) — jamás en pruebas destructivas`,
    );
  }
  if (!HOSTS_LOCALES.has(host) && env.SOEC_TEST_DB_ALLOW_REMOTE !== 'true') {
    throw new BaseDePruebaInseguraError(
      `host remoto '${host}' sin autorización explícita (SOEC_TEST_DB_ALLOW_REMOTE=true)`,
    );
  }

  // (c) Nombre de la base: contrato duro.
  const base = nombreBaseDe(url);
  if (BASES_PROHIBIDAS.has(base.toLowerCase())) {
    throw new BaseDePruebaInseguraError(`'${base}' es una base operativa/reservada, no de prueba`);
  }
  if (!base.toLowerCase().endsWith(SUFIJO_BASE_DE_PRUEBA)) {
    throw new BaseDePruebaInseguraError(
      `el nombre '${base}' no termina en '${SUFIJO_BASE_DE_PRUEBA}' (una base de prueba debe declararse como tal)`,
    );
  }
  return base;
}

/** ¿Es segura? (no lanza) — útil para aserciones y diagnósticos. */
export function esBaseDePruebaSegura(
  url: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    assertSafeTestDatabase(url, env);
    return true;
  } catch {
    return false;
  }
}

/**
 * URL de la base de prueba. **Nunca** consulta `DATABASE_URL`: el runtime y las pruebas no comparten
 * variable de conexión, de modo que no existe forma de "heredar" la base operativa por descuido.
 */
export function urlBaseDePrueba(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const url = env[VAR_URL_BASE_DE_PRUEBA] ?? URL_BASE_DE_PRUEBA_POR_DEFECTO;
  assertSafeTestDatabase(url, env);
  return url;
}

/** Pool contra la base de PRUEBA, validado antes de conectar. Es el único constructor para tests PG. */
export function makeTestPool(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Pool {
  return new Pool({ connectionString: urlBaseDePrueba(env), max: 10 });
}

/**
 * Vuelve a validar contra la base REALMENTE conectada (no contra la cadena que creyó usar el llamador).
 * Es la última línea de defensa: un pool construido por cualquier vía queda igualmente cubierto.
 */
export async function assertPoolEsBaseDePrueba(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ db: string }>('select current_database() as db');
  const base = rows[0]?.db ?? '';
  if (BASES_PROHIBIDAS.has(base.toLowerCase())) {
    throw new BaseDePruebaInseguraError(`el pool está conectado a la base operativa '${base}'`);
  }
  if (!base.toLowerCase().endsWith(SUFIJO_BASE_DE_PRUEBA)) {
    throw new BaseDePruebaInseguraError(
      `el pool está conectado a '${base}', que no es una base de prueba (falta '${SUFIJO_BASE_DE_PRUEBA}')`,
    );
  }
  return base;
}

const DESTRUCTIVAS = /^\s*(truncate|drop|delete\s+from|alter\s+table|reset)\b/i;

/**
 * Ejecuta una sentencia DESTRUCTIVA (TRUNCATE/DROP/DELETE/…) **sólo** si la base realmente conectada
 * es de prueba. Sustituye a `pool.query('truncate …')` en todas las suites PG.
 *
 * No confía en el llamador: revalida en cada invocación contra `current_database()`.
 */
export async function ejecutarDestructivoDePrueba(pool: Pool, sql: string): Promise<void> {
  if (!DESTRUCTIVAS.test(sql)) {
    throw new BaseDePruebaInseguraError(
      'ejecutarDestructivoDePrueba sólo admite sentencias destructivas (truncate/drop/delete/alter/reset)',
    );
  }
  await assertPoolEsBaseDePrueba(pool);
  await pool.query(sql);
}

/**
 * Crea la base de prueba si no existe. **Nunca** toca ni recrea la base operativa: se conecta a la
 * base de mantenimiento `postgres` y sólo emite `CREATE DATABASE <nombre_test>`.
 */
export async function asegurarBaseDePrueba(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ base: string; creada: boolean }> {
  const url = urlBaseDePrueba(env); // valida antes de nada
  const base = nombreBaseDe(url);

  const mantenimiento = new URL(url);
  mantenimiento.pathname = '/postgres';
  const admin = new Pool({ connectionString: mantenimiento.toString(), max: 1 });
  try {
    const { rows } = await admin.query<{ n: number }>(
      'select count(*)::int as n from pg_database where datname = $1',
      [base],
    );
    if ((rows[0]?.n ?? 0) > 0) return { base, creada: false };
    // Identificador citado: `base` ya pasó el contrato de nombre (sufijo `_test`, no reservada).
    await admin.query(`create database "${base.replace(/"/g, '""')}"`);
    return { base, creada: true };
  } finally {
    await admin.end();
  }
}
