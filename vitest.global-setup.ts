/**
 * globalSetup de Vitest — prepara la BASE DE PRUEBA y deja constancia de cuál es.
 *
 * Crea `soec_test` si no existe. NUNCA toca `soec`: `asegurarBaseDePrueba` valida el contrato de
 * nombre antes de conectarse siquiera, y sólo emite `CREATE DATABASE`. La base operativa jamás se
 * recrea, se borra ni se migra desde aquí.
 *
 * Si PostgreSQL no está disponible, no se aborta: las suites que lo necesiten fallarán con su propio
 * mensaje. Lo que SÍ aborta es que la URL de prueba no cumpla el contrato.
 */
// Ruta relativa a propósito: el config raíz no es un workspace y no resuelve subrutas `@soec/*`.
import { asegurarBaseDePrueba, urlBaseDePrueba } from './packages/event-store/src/pg/test-db';

export default async function setup(): Promise<void> {
  // Explícito: estamos en el corredor de pruebas. La guarda de `test-db` lo exige.
  process.env.NODE_ENV = 'test';

  const url = urlBaseDePrueba(); // lanza si la URL no es una base de prueba legítima
  const base = new URL(url).pathname.replace(/^\//, '');

  try {
    const r = await asegurarBaseDePrueba();
    console.log(
      `[vitest] base de PRUEBA = ${r.base}${r.creada ? ' (creada)' : ''} · la base operativa no se toca`,
    );
  } catch (e) {
    console.warn(
      `[vitest] no se pudo asegurar la base de prueba '${base}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
