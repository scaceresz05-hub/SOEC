/**
 * Dominio de identidad: permisos efectivos por rol, hash/verify de contraseñas (scrypt) y política
 * de modos operativos (AUTONOMOUS_REAL bloqueado). Puro, sin base de datos.
 */
import { describe, it, expect } from 'vitest';
import { permisosDeRol, rolTienePermiso, esRol } from '../src/domain/roles';
import { hashPassword, verifyPassword } from '../src/domain/password';
import { modoActivable, esModo } from '../src/domain/modo';
import { normalizarEmail, slugValido, generarTokenSesion, hashToken } from '../src/domain/entities';

describe('@soec/identity · roles y permisos', () => {
  it('OWNER concede administración; VIEWER solo lectura', () => {
    expect(rolTienePermiso('OWNER', 'operational_mode.manage')).toBe(true);
    expect(rolTienePermiso('OWNER', 'members.manage')).toBe(true);
    expect(rolTienePermiso('VIEWER', 'organization.read')).toBe(true);
    expect(rolTienePermiso('VIEWER', 'members.manage')).toBe(false);
    expect(rolTienePermiso('VIEWER', 'content.approve')).toBe(false);
  });

  it('MARKETING_OPERATOR gestiona programas pero NO aprueba contenido ni administra miembros', () => {
    expect(rolTienePermiso('MARKETING_OPERATOR', 'program.manage')).toBe(true);
    expect(rolTienePermiso('MARKETING_OPERATOR', 'content.approve')).toBe(false);
    expect(rolTienePermiso('MARKETING_OPERATOR', 'members.manage')).toBe(false);
  });

  it('ANALYST puede leer auditoría pero no gestionar', () => {
    expect(rolTienePermiso('ANALYST', 'audit.read')).toBe(true);
    expect(rolTienePermiso('ANALYST', 'program.manage')).toBe(false);
  });

  it('permisosDeRol devuelve el conjunto efectivo', () => {
    expect(permisosDeRol('OWNER').has('execution.approve')).toBe(true);
    expect(permisosDeRol('VIEWER').has('execution.approve')).toBe(false);
    expect(esRol('OWNER')).toBe(true);
    expect(esRol('SUPERUSER')).toBe(false);
  });
});

describe('@soec/identity · contraseñas (scrypt)', () => {
  it('hashea y verifica correctamente', () => {
    const h = hashPassword('SuperSecreta123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('SuperSecreta123'); // nunca texto plano
    expect(verifyPassword('SuperSecreta123', h)).toBe(true);
    expect(verifyPassword('otra', h)).toBe(false);
  });

  it('rechaza contraseñas demasiado cortas', () => {
    expect(() => hashPassword('corta')).toThrow();
  });

  it('verify es robusto ante hash malformado', () => {
    expect(verifyPassword('x', 'no-es-un-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$16384$8$1$deadbeef')).toBe(false);
  });
});

describe('@soec/identity · modos operativos', () => {
  it('PILOT y SUPERVISED_REAL son activables; AUTONOMOUS_REAL está bloqueado', () => {
    expect(modoActivable('PILOT').ok).toBe(true);
    expect(modoActivable('SUPERVISED_REAL').ok).toBe(true);
    expect(modoActivable('AUTONOMOUS_REAL').ok).toBe(false);
    expect(modoActivable('AUTONOMOUS_REAL').motivo).toContain('NOT_AVAILABLE');
    expect(esModo('AUTONOMOUS_REAL')).toBe(true);
    expect(esModo('CUALQUIERA')).toBe(false);
  });
});

describe('@soec/identity · helpers', () => {
  it('normaliza email y valida slug', () => {
    expect(normalizarEmail('  Foo@BAR.com ')).toBe('foo@bar.com');
    expect(slugValido('smileflow')).toBe(true);
    expect(slugValido('SmileFlow')).toBe(false);
    expect(slugValido('a')).toBe(false);
  });

  it('genera token de sesión y su hash (el token no es el hash)', () => {
    const { token, tokenHash } = generarTokenSesion();
    expect(token).not.toBe(tokenHash);
    expect(hashToken(token)).toBe(tokenHash);
    expect(tokenHash).toHaveLength(64); // sha256 hex
  });
});
