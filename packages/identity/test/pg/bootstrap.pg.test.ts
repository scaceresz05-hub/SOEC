/**
 * Bootstrap idempotente: deshabilitado por defecto; con variables crea owner+org+membresía OWNER;
 * re-ejecutar no duplica ni sobrescribe. Nunca credenciales hardcodeadas (vienen del entorno).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makePool, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '../../src/pg/migrations';
import { ejecutarBootstrap } from '../../src/application/bootstrap';
import { organizacionPorSlug, organizacionesDeUsuario, usuarioPorEmail } from '../../src/pg/repositories';

const pool = makePool(process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec');
const env = { enabled: true, ownerEmail: 'owner@smileflow.test', ownerPassword: 'Password123', ownerName: 'Owner', orgSlug: 'smileflow-boot', orgName: 'SmileFlow' };

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('@soec/identity · bootstrap', () => {
  it('deshabilitado por defecto no ejecuta nada', async () => {
    const r = await ejecutarBootstrap(pool, { ...env, enabled: false });
    expect(r.ejecutado).toBe(false);
    expect(await usuarioPorEmail(pool, env.ownerEmail)).toBeNull();
  });

  it('con variables crea owner + organización + membresía OWNER', async () => {
    const r = await ejecutarBootstrap(pool, env);
    expect(r.ejecutado).toBe(true);
    expect(r.userCreado).toBe(true);
    expect(r.orgCreada).toBe(true);
    const user = await usuarioPorEmail(pool, env.ownerEmail);
    expect(user).not.toBeNull();
    const org = await organizacionPorSlug(pool, env.orgSlug);
    expect(org?.operationalMode).toBe('PILOT');
    const orgs = await organizacionesDeUsuario(pool, user!.id);
    expect(orgs[0]?.role).toBe('OWNER');
  });

  it('es idempotente: re-ejecutar no duplica ni sobrescribe', async () => {
    await ejecutarBootstrap(pool, env);
    const r2 = await ejecutarBootstrap(pool, env);
    expect(r2.ejecutado).toBe(true);
    expect(r2.userCreado).toBe(false); // ya existía
    expect(r2.orgCreada).toBe(false);
    const { rows } = await pool.query('select count(*)::int as n from identity_users');
    expect(rows[0].n).toBe(1);
    const m = await pool.query('select count(*)::int as n from identity_memberships');
    expect(m.rows[0].n).toBe(1);
  });
});
