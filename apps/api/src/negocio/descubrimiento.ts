/**
 * apps/api · NEGOCIO COMO DATO · descubrimiento de organizaciones para los runtimes.
 *
 * Los bucles de fondo preguntaban «¿qué empresas existen?» a un array en código. Ahora lo preguntan a la
 * base: una empresa creada desde la interfaz aparece en el siguiente tick, sin desplegar nada.
 *
 * COMPATIBILIDAD DECLARADA: durante la transición se devuelve la UNIÓN de las organizaciones con perfil
 * persistido y las del registro TypeScript. La unión existe por seguridad —si una migración no corrió, la
 * empresa histórica sigue siendo descubierta— y no por diseño: una empresa NUEVA nunca depende del registro.
 */
import type { Pool } from 'pg';
import { organizacionesRegistradas } from '../plataforma';
import { RepositorioNegocios } from './negocio-pg';

/** Devuelve los identificadores de tenant que el runtime debe considerar, sin repetir. */
export type DescubridorDeNegocios = () => Promise<readonly string[]>;

export function crearDescubridorDeNegocios(pool: Pool): DescubridorDeNegocios {
  const repo = new RepositorioNegocios(pool);
  return async () => {
    const persistidos = (await repo.listarTodos()).map((p) => p.organizationId);
    const legado = organizacionesRegistradas();
    return [...new Set([...persistidos, ...legado])];
  };
}

/** Descubridor que sólo mira el registro histórico. Útil donde todavía no hay base (tests unitarios). */
export const descubridorDelRegistro: DescubridorDeNegocios = async () => organizacionesRegistradas();
