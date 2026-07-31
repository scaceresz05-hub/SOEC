/**
 * Endurecimiento de sesión (incremento final Macrobloque 1): rotación de sesión en login,
 * revocación de sesiones al suspender/revocar una membresía, y flujo de restablecimiento de
 * contraseña (token de un solo uso, invalida sesiones). Requiere PostgreSQL de test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makePool, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '../../src/pg/migrations';
import { IdentityService } from '../../src/application/identity-service';

const pool = makePool(process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec');
const svc = new IdentityService(pool);

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('@soec/identity · endurecimiento de sesión', () => {
  it('login ROTA la sesión presentada: la anterior queda revocada, la nueva vigente', async () => {
    await svc.registrar('a@x.com', 'A', 'Password123');
    const l1 = await svc.login('a@x.com', 'Password123');
    expect(await svc.resolverSesion(l1.token)).not.toBeNull();
    const l2 = await svc.login('a@x.com', 'Password123', { tokenSesionPrevio: l1.token });
    expect(await svc.resolverSesion(l1.token)).toBeNull(); // rotada
    expect(await svc.resolverSesion(l2.token)).not.toBeNull();
  });

  it('suspender a un miembro REVOCA sus sesiones (defensa en profundidad)', async () => {
    const owner = await svc.registrar('o@x.com', 'O', 'Password123');
    await svc.crearOrganizacion(owner.id, 'org-a', 'Org A');
    const ctxOwner = await svc.resolverContextoOrganizacion(owner, 'org-a');
    const { token } = await svc.invitarMiembro(ctxOwner, 'an@x.com', 'ANALYST');
    await svc.aceptarInvitacion(token, 'An', 'Password123');
    const la = await svc.login('an@x.com', 'Password123');
    expect(await svc.resolverSesion(la.token)).not.toBeNull();
    const miembros = await svc.listarMiembros(ctxOwner);
    const m = miembros.find((x) => x.email === 'an@x.com')!;
    await svc.cambiarEstadoMiembro(ctxOwner, m.membership.id, 'SUSPENDED');
    expect(await svc.resolverSesion(la.token)).toBeNull(); // sesión invalidada
  });

  it('password reset: solicita → confirma → invalida sesiones y credencial anterior', async () => {
    await svc.registrar('a@x.com', 'A', 'Password123');
    const l = await svc.login('a@x.com', 'Password123');
    const req = await svc.solicitarResetPassword('a@x.com');
    expect(req).not.toBeNull();
    await svc.confirmarResetPassword(req!.token, 'NuevaClave456');
    expect(await svc.resolverSesion(l.token)).toBeNull(); // sesiones revocadas
    // token de un solo uso: reusarlo falla
    await expect(svc.confirmarResetPassword(req!.token, 'OtraClave789')).rejects.toThrow();
    // la contraseña anterior ya no sirve; la nueva sí
    await expect(svc.login('a@x.com', 'Password123')).rejects.toThrow();
    const l2 = await svc.login('a@x.com', 'NuevaClave456');
    expect(l2.token).toBeTruthy();
  });

  it('solicitar reset de un email inexistente devuelve null (no enumera cuentas)', async () => {
    expect(await svc.solicitarResetPassword('nadie@x.com')).toBeNull();
  });

  it('confirmar reset con token inválido → NoEncontrado; con contraseña corta → EntradaInvalida', async () => {
    await svc.registrar('a@x.com', 'A', 'Password123');
    await expect(svc.confirmarResetPassword('token-basura', 'NuevaClave456')).rejects.toThrow();
    const req = await svc.solicitarResetPassword('a@x.com');
    await expect(svc.confirmarResetPassword(req!.token, 'corta')).rejects.toThrow();
  });
});
