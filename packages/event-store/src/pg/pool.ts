import { Pool } from 'pg';

/** Crea un pool de PostgreSQL. La cadena de conexión es Nivel C (reemplazable). */
export function makePool(connectionString: string | undefined = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL no definido — la Base Técnica requiere PostgreSQL');
  }
  return new Pool({ connectionString, max: 10 });
}
