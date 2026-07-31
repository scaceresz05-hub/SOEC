/**
 * @soec/identity · aplicación · Bootstrap controlado e idempotente.
 *
 * Crea (si no existen) el owner inicial y su organización a partir de VARIABLES DE ENTORNO —
 * nunca credenciales hardcodeadas. Sólo se ejecuta si `SOEC_BOOTSTRAP_ENABLED=true`. Idempotente:
 * no sobrescribe cuentas ni organizaciones existentes. Registra auditoría.
 */
import type { Pool } from 'pg';
import * as repo from '../pg/repositories';
import { hashPassword } from '../domain/password';
import { normalizarEmail, slugValido } from '../domain/entities';

export interface BootstrapEnv {
  readonly enabled: boolean;
  readonly ownerEmail?: string;
  readonly ownerPassword?: string;
  readonly ownerName?: string;
  readonly orgSlug?: string;
  readonly orgName?: string;
}

export function leerBootstrapEnv(env: NodeJS.ProcessEnv = process.env): BootstrapEnv {
  return {
    enabled: env.SOEC_BOOTSTRAP_ENABLED === 'true',
    ownerEmail: env.SOEC_BOOTSTRAP_OWNER_EMAIL,
    ownerPassword: env.SOEC_BOOTSTRAP_OWNER_PASSWORD,
    ownerName: env.SOEC_BOOTSTRAP_OWNER_NAME ?? 'Owner',
    orgSlug: env.SOEC_BOOTSTRAP_ORG_SLUG,
    orgName: env.SOEC_BOOTSTRAP_ORG_NAME,
  };
}

export interface BootstrapResultado {
  readonly ejecutado: boolean;
  readonly motivo: string;
  readonly userCreado?: boolean;
  readonly orgCreada?: boolean;
  readonly slug?: string;
}

/** Ejecuta el bootstrap si está habilitado. Idempotente; no sobrescribe. */
export async function ejecutarBootstrap(pool: Pool, env = leerBootstrapEnv()): Promise<BootstrapResultado> {
  if (!env.enabled) return { ejecutado: false, motivo: 'SOEC_BOOTSTRAP_ENABLED no es true' };
  if (!env.ownerEmail || !env.ownerPassword || !env.orgSlug || !env.orgName) {
    return { ejecutado: false, motivo: 'faltan variables de bootstrap (email/password/orgSlug/orgName)' };
  }
  const email = normalizarEmail(env.ownerEmail);
  const slug = env.orgSlug.trim().toLowerCase();
  if (!slugValido(slug)) return { ejecutado: false, motivo: 'orgSlug inválido' };

  const client = await pool.connect();
  try {
    await client.query('begin');
    let user = await repo.usuarioPorEmail(client, email);
    let userCreado = false;
    if (!user) {
      user = await repo.crearUsuario(client, email, env.ownerName ?? 'Owner', hashPassword(env.ownerPassword), 'ACTIVE');
      userCreado = true;
    }
    let org = await repo.organizacionPorSlug(client, slug);
    let orgCreada = false;
    if (!org) {
      org = await repo.crearOrganizacion(client, slug, env.orgName, 'PILOT');
      orgCreada = true;
    }
    const membresia = await repo.membresiaActiva(client, user.id, org.id);
    if (!membresia) await repo.crearMembresia(client, user.id, org.id, 'OWNER', 'ACTIVE');
    await repo.registrarAuditoria(client, { organizationId: org.id, actorUserId: user.id, action: 'bootstrap.executed', resourceType: 'organization', resourceId: org.id, result: 'SUCCESS', metadata: { userCreado, orgCreada, slug } });
    await client.query('commit');
    return { ejecutado: true, motivo: 'bootstrap aplicado (idempotente)', userCreado, orgCreada, slug };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
