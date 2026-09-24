/**
 * GATE DE MIGRACIONES · ¿pueden coexistir dos migraciones que se llaman «0002»?
 *
 * La pregunta nace de un hecho: producción ya tiene `0002_techo_en_unidades_menores` (el techo de inversión en
 * unidades menores) y la Fase I.3 añade `0002_handoff_proveedor_y_cancelacion`. Si el registro de migraciones
 * estuviera indexado por el número, la segunda se daría por aplicada sin ejecutarse: el despliegue diría «todo
 * en orden» y la tabla nunca tendría su columna. Un fallo así no se nota hasta que algo lee la columna.
 *
 * Lo que estas pruebas fijan:
 *
 *  1. el ledger es UNO y está indexado por el ID COMPLETO, no por el número ni por un namespace;
 *  2. por tanto, dos «0002» con nombre distinto conviven y ambas se aplican;
 *  3. y el corolario incómodo: dos migraciones con el MISMO id, aunque vivan en paquetes distintos, se
 *     saltarían en silencio. Eso convierte «los ids son únicos en todo el repositorio» en una invariante que
 *     merece una prueba, no una convención que alguien recuerde.
 *  4. Sobre una base que ya tiene el 0002 financiero, correr las migraciones aplica sólo lo pendiente, no
 *     repite DDL y no toca los datos que ya estaban.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type Migration } from '@soec/event-store/pg';
import { makeTestPool } from '@soec/event-store/test-db';
import { negocioMigrations } from '../src/negocio/negocio-pg';
import { conexionMigrations } from '../src/conexion/conexion-pg';
import { politicaMigrations } from '../src/politica/politica-pg';
import { onboardingMigrations } from '../src/onboarding/onboarding-pg';
import { investigacionMigrations } from '../src/investigacion/investigacion-pg';
import { planMigrations } from '../src/investigacion/plan-pg';
import { accionMigrations } from '../src/accion/accion-pg';
import { ejecucionMigrations } from '../src/ejecucion/ejecucion-pg';
import { optimizacionMigrations } from '../src/optimizacion/optimizacion-pg';
import { handoffMigrations } from '../src/handoff/handoff-pg';
import { googleAdsOAuthMigrations } from '../src/acquisition/google-ads-oauth-pg';

const pool = makeTestPool();

/** Todos los conjuntos que el arranque de la API aplica sobre la MISMA base. */
const CONJUNTOS: ReadonlyArray<readonly [string, ReadonlyArray<Migration>]> = [
  ['negocio', negocioMigrations],
  ['conexion', conexionMigrations],
  ['politica', politicaMigrations],
  ['onboarding', onboardingMigrations],
  ['investigacion', investigacionMigrations],
  ['plan', planMigrations],
  ['accion', accionMigrations],
  ['ejecucion', ejecucionMigrations],
  ['optimizacion', optimizacionMigrations],
  ['handoff', handoffMigrations],
  ['google-ads-oauth', googleAdsOAuthMigrations],
];

beforeEach(async () => {
  await runMigrations(pool);
  for (const [, set] of CONJUNTOS) await runMigrations(pool, set);
});
afterAll(async () => { await pool.end(); });

describe('el registro de migraciones', () => {
  it('es uno solo y está indexado por el id completo: no hay namespace por paquete', async () => {
    const { rows } = await pool.query(
      `select column_name, data_type from information_schema.columns
        where table_name = 'schema_migrations' order by ordinal_position`,
    );
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual(['id', 'applied_at']);

    // La clave primaria es el id, entero: no hay columna de paquete, conjunto ni versión.
    const pk = await pool.query(
      `select a.attname from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = 'schema_migrations'::regclass and i.indisprimary`,
    );
    expect(pk.rows.map((r: { attname: string }) => r.attname)).toEqual(['id']);
  });

  it('los ids son únicos en TODO el repositorio, que es lo que hace seguro repetir el número', () => {
    const vistos = new Map<string, string>();
    const choques: string[] = [];
    for (const [paquete, set] of CONJUNTOS) {
      for (const m of set) {
        const previo = vistos.get(m.id);
        if (previo !== undefined) choques.push(`«${m.id}» está en ${previo} y en ${paquete}`);
        else vistos.set(m.id, paquete);
      }
    }
    expect(choques, 'dos migraciones con el mismo id: la segunda se saltaría en silencio').toEqual([]);

    // Y el número SÍ se repite, a propósito: siete conjuntos tienen su propio «0002».
    const segundas = [...vistos.keys()].filter((id) => id.startsWith('0002_'));
    expect(segundas.length).toBeGreaterThan(1);
    expect(segundas).toContain('0002_techo_en_unidades_menores');
    expect(segundas).toContain('0002_handoff_proveedor_y_cancelacion');
  });

  it('ambos «0002» están aplicados y cada uno hizo su trabajo', async () => {
    const { rows } = await pool.query(
      "select id from schema_migrations where id like '0002!_%' escape '!' order by id",
    );
    const ids = rows.map((r: { id: string }) => r.id);
    expect(ids).toContain('0002_techo_en_unidades_menores');
    expect(ids).toContain('0002_handoff_proveedor_y_cancelacion');

    // El efecto, no sólo el registro: la columna del techo y las del handoff existen.
    const columnas = async (tabla: string): Promise<string[]> => {
      const r = await pool.query('select column_name from information_schema.columns where table_name = $1', [tabla]);
      return r.rows.map((x: { column_name: string }) => x.column_name);
    };
    expect(await columnas('business_budget_intent')).toContain('monto_minor');
    const handoff = await columnas('external_handoff');
    expect(handoff).toContain('proveedor');
    expect(handoff).toContain('cancelado_en');
  });

  it('volver a correrlas no aplica nada, no repite DDL y no toca los datos', async () => {
    // Un dato que ya estaba, del lado del handoff.
    await pool.query(
      `insert into external_handoff (id, organization_id, proveedor, canal, tipo, estado, causa, instruccion,
         motivo, etiqueta_accion, metadata)
       values ('hand-gate-0001', 'org-gate-migraciones', 'GOOGLE', 'GOOGLE_ADS', 'ACCOUNT_PROVISIONING_REQUIRED',
         'OPEN', 'sin-cuenta', 'Crea tu cuenta', 'no hay cuenta', 'Continuar', '{}'::jsonb)
       on conflict (id) do nothing`,
    );

    const aplicadas: string[] = [];
    for (const [, set] of CONJUNTOS) aplicadas.push(...(await runMigrations(pool, set)));
    expect(aplicadas, 'la segunda pasada no debe aplicar ninguna migración').toEqual([]);

    const { rows } = await pool.query("select estado, proveedor from external_handoff where id = 'hand-gate-0001'");
    expect(rows[0]).toEqual({ estado: 'OPEN', proveedor: 'GOOGLE' });
    await pool.query("delete from external_handoff where organization_id = 'org-gate-migraciones'");
  });

  /**
   * La semántica del ledger compartido, demostrada con ids de juguete: un id nuevo se aplica aunque empiece por
   * el mismo número, y un id REPETIDO se salta en silencio. Lo segundo es la razón por la que la prueba de
   * unicidad de arriba existe.
   */
  it('mismo número ⇒ se aplica; mismo id ⇒ se salta sin avisar', async () => {
    await pool.query('drop table if exists gate_migraciones_a, gate_migraciones_b');
    await pool.query("delete from schema_migrations where id like '9999!_%' escape '!'");

    const conjuntoA: Migration[] = [{ id: '9999_gate_a', sql: 'create table gate_migraciones_a (x int)' }];
    const conjuntoB: Migration[] = [{ id: '9999_gate_b', sql: 'create table gate_migraciones_b (x int)' }];
    expect(await runMigrations(pool, conjuntoA)).toEqual(['9999_gate_a']);
    expect(await runMigrations(pool, conjuntoB)).toEqual(['9999_gate_b']);
    const existe = async (t: string): Promise<boolean> =>
      (await pool.query('select to_regclass($1) as r', [t])).rows[0].r !== null;
    expect(await existe('gate_migraciones_a')).toBe(true);
    expect(await existe('gate_migraciones_b')).toBe(true);

    // Un tercer conjunto que reutiliza el id de A: su DDL NUNCA se ejecuta.
    const impostor: Migration[] = [{ id: '9999_gate_a', sql: 'create table gate_migraciones_c (x int)' }];
    expect(await runMigrations(pool, impostor)).toEqual([]);
    expect(await existe('gate_migraciones_c')).toBe(false);

    await pool.query('drop table if exists gate_migraciones_a, gate_migraciones_b, gate_migraciones_c');
    await pool.query("delete from schema_migrations where id like '9999!_%' escape '!'");
  });
});
