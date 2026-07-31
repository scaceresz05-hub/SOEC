/**
 * Identidad sobre PostgreSQL: login/sesiones, creación transaccional de organización, y la MATRIZ
 * DE AISLAMIENTO multi-tenant (la parte crítica): un usuario sólo accede a organizaciones donde
 * tiene membresía activa; conocer un slug ajeno no da acceso (404); los permisos por rol se
 * respetan; sesiones revocables; modo AUTONOMOUS_REAL bloqueado; auditoría registrada.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makePool, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '../../src/pg/migrations';
import { IdentityService } from '../../src/application/identity-service';
import { NoAutenticadoError, NoEncontradoError, SinPermisoError, PoliticaError, ConflictoError } from '../../src/domain/errors';

const pool = makePool(process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec');
const svc = new IdentityService(pool);

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
});
afterAll(async () => {
  await pool.end();
});

async function ownerConOrg(email: string, slug: string) {
  const user = await svc.registrar(email, 'Owner', 'Password123');
  const org = await svc.crearOrganizacion(user.id, slug, `Org ${slug}`);
  return { user, org };
}

describe('@soec/identity · autenticación', () => {
  it('login correcto crea sesión; login inválido no revela nada', async () => {
    await svc.registrar('a@x.com', 'A', 'Password123');
    const ok = await svc.login('a@x.com', 'Password123');
    expect(ok.token).toBeTruthy();
    expect(ok.session.id).toBeTruthy();
    await expect(svc.login('a@x.com', 'mala')).rejects.toBeInstanceOf(NoAutenticadoError);
    await expect(svc.login('noexiste@x.com', 'Password123')).rejects.toBeInstanceOf(NoAutenticadoError);
  });

  it('la sesión se resuelve por token y deja de resolver tras revocar', async () => {
    await svc.registrar('a@x.com', 'A', 'Password123');
    const { token } = await svc.login('a@x.com', 'Password123');
    expect((await svc.resolverSesion(token))?.user.email).toBe('a@x.com');
    await svc.logout(token);
    expect(await svc.resolverSesion(token)).toBeNull();
    expect(await svc.resolverSesion(undefined)).toBeNull();
  });

  it('registrar el mismo email dos veces es conflicto', async () => {
    await svc.registrar('a@x.com', 'A', 'Password123');
    await expect(svc.registrar('A@X.com', 'A', 'Password123')).rejects.toBeInstanceOf(ConflictoError);
  });
});

describe('@soec/identity · aislamiento multi-tenant (matriz)', () => {
  it('un usuario accede a SU organización, NO a la de otro (404 por slug ajeno)', async () => {
    const a = await ownerConOrg('a@x.com', 'org-a');
    const b = await ownerConOrg('b@x.com', 'org-b');
    // A_OWNER vs A → ok
    const ctxA = await svc.resolverContextoOrganizacion(a.user, 'org-a');
    expect(ctxA.membership.role).toBe('OWNER');
    // A_OWNER vs B → 404 (no revela existencia)
    await expect(svc.resolverContextoOrganizacion(a.user, 'org-b')).rejects.toBeInstanceOf(NoEncontradoError);
    // B_OWNER vs A → 404
    await expect(svc.resolverContextoOrganizacion(b.user, 'org-a')).rejects.toBeInstanceOf(NoEncontradoError);
    // slug inexistente → 404
    await expect(svc.resolverContextoOrganizacion(a.user, 'no-existe')).rejects.toBeInstanceOf(NoEncontradoError);
  });

  it('permisos por rol: VIEWER no administra miembros; OWNER sí', async () => {
    const a = await ownerConOrg('a@x.com', 'org-a');
    const ctxOwner = await svc.resolverContextoOrganizacion(a.user, 'org-a');
    // Invitar un VIEWER y aceptar.
    const { token } = await svc.invitarMiembro(ctxOwner, 'viewer@x.com', 'VIEWER');
    const { user: viewer } = await svc.aceptarInvitacion(token, 'Viewer', 'Password123');
    const ctxViewer = await svc.resolverContextoOrganizacion(viewer, 'org-a');
    // VIEWER puede LEER miembros (rol de lectura) pero NO administrarlos (invitar) → 403.
    expect((await svc.listarMiembros(ctxViewer)).length).toBe(2);
    await expect(svc.invitarMiembro(ctxViewer, 'x@x.com', 'ANALYST')).rejects.toBeInstanceOf(SinPermisoError);
    expect((await svc.listarMiembros(ctxOwner)).length).toBe(2);
    // VIEWER intenta cambiar modo → 403.
    await expect(svc.cambiarModoOperativo(ctxViewer, 'SUPERVISED_REAL')).rejects.toBeInstanceOf(SinPermisoError);
  });

  it('membresía suspendida deja de dar acceso (404)', async () => {
    const a = await ownerConOrg('a@x.com', 'org-a');
    const ctxOwner = await svc.resolverContextoOrganizacion(a.user, 'org-a');
    const { token } = await svc.invitarMiembro(ctxOwner, 'op@x.com', 'MARKETING_OPERATOR');
    const { user: op, membership } = await svc.aceptarInvitacion(token, 'Op', 'Password123');
    await svc.resolverContextoOrganizacion(op, 'org-a'); // funciona
    await svc.cambiarEstadoMiembro(ctxOwner, membership.id, 'SUSPENDED');
    await expect(svc.resolverContextoOrganizacion(op, 'org-a')).rejects.toBeInstanceOf(NoEncontradoError);
  });

  it('un miembro no puede modificar/suspender a un OWNER', async () => {
    const a = await ownerConOrg('a@x.com', 'org-a');
    const ctxOwner = await svc.resolverContextoOrganizacion(a.user, 'org-a');
    const { token } = await svc.invitarMiembro(ctxOwner, 'admin@x.com', 'ADMIN');
    const { user: admin } = await svc.aceptarInvitacion(token, 'Admin', 'Password123');
    const ctxAdmin = await svc.resolverContextoOrganizacion(admin, 'org-a');
    const miembros = await svc.listarMiembros(ctxAdmin);
    const ownerMembership = miembros.find((m) => m.membership.role === 'OWNER')!;
    await expect(svc.cambiarEstadoMiembro(ctxAdmin, ownerMembership.membership.id, 'REVOKED')).rejects.toBeInstanceOf(PoliticaError);
  });
});

describe('@soec/identity · modo operativo y auditoría', () => {
  it('cambiar a AUTONOMOUS_REAL es rechazado por política', async () => {
    const a = await ownerConOrg('a@x.com', 'org-a');
    const ctx = await svc.resolverContextoOrganizacion(a.user, 'org-a');
    expect((await svc.cambiarModoOperativo(ctx, 'SUPERVISED_REAL')).operationalMode).toBe('SUPERVISED_REAL');
    await expect(svc.cambiarModoOperativo(ctx, 'AUTONOMOUS_REAL')).rejects.toBeInstanceOf(PoliticaError);
  });

  it('la auditoría registra el login y es visible para quien tiene permiso', async () => {
    const a = await ownerConOrg('a@x.com', 'org-a');
    const ctx = await svc.resolverContextoOrganizacion(a.user, 'org-a');
    const eventos = await svc.listarAuditoria(ctx);
    expect(eventos.some((e) => e.action === 'organization.created')).toBe(true);
  });
});
