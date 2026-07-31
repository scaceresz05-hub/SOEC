/**
 * Endurecimiento de contraseñas (F-02/F-03/F-04/F-05): formato v2, compatibilidad de verificación
 * con hashes v1 antiguos, marca de rehash, límites de longitud (min/max) antes de scrypt, robustez
 * ante formato desconocido, y existencia del hash señuelo estable para anti-enumeración.
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HASH_SEÑUELO,
  LONGITUD_MAXIMA,
  LONGITUD_MINIMA,
  hashPassword,
  necesitaRehash,
  verifyPassword,
} from '../src/domain/password';

/** Reproduce un hash v1 (formato antiguo scrypt$N$r$p$salt$hash, N=2^14) para probar compatibilidad. */
function hashV1(plano: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plano, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

describe('@soec/identity · endurecimiento de contraseñas', () => {
  it('genera hash v2 y lo verifica; no necesita rehash', () => {
    const h = hashPassword('Password123');
    expect(h.startsWith('scrypt$v2$')).toBe(true);
    expect(h).not.toContain('Password123');
    expect(verifyPassword('Password123', h)).toBe(true);
    expect(verifyPassword('Password999', h)).toBe(false);
    expect(necesitaRehash(h)).toBe(false);
  });

  it('verifica hashes v1 antiguos (compatibilidad) y los marca para rehash', () => {
    const v1 = hashV1('Password123');
    expect(verifyPassword('Password123', v1)).toBe(true);
    expect(verifyPassword('Password999', v1)).toBe(false);
    expect(necesitaRehash(v1)).toBe(true); // v1 debe re-derivarse a v2
  });

  it('aplica límites de longitud antes de derivar (F-03/F-04)', () => {
    expect(() => hashPassword('a'.repeat(LONGITUD_MINIMA - 1))).toThrow();
    expect(() => hashPassword('a'.repeat(LONGITUD_MINIMA))).not.toThrow();
    expect(() => hashPassword('a'.repeat(LONGITUD_MAXIMA))).not.toThrow();
    expect(() => hashPassword('a'.repeat(LONGITUD_MAXIMA + 1))).toThrow();
    // verify NO ejecuta scrypt sobre entradas fuera de rango (protección de CPU) → false directo
    expect(verifyPassword('a'.repeat(LONGITUD_MAXIMA + 1000), HASH_SEÑUELO)).toBe(false);
  });

  it('verify es robusto ante formato desconocido o parámetros inválidos', () => {
    expect(verifyPassword('Password123', 'no-es-un-hash')).toBe(false);
    expect(verifyPassword('Password123', 'scrypt$v2$abc$8$1$deadbeef$cafe')).toBe(false); // N no numérico
    expect(verifyPassword('Password123', 'scrypt$16384$8$1$deadbeef')).toBe(false); // v1 incompleto
  });

  it('el hash señuelo estable es un hash v2 válido (anti-enumeración por temporización)', () => {
    expect(HASH_SEÑUELO.startsWith('scrypt$v2$')).toBe(true);
    expect(necesitaRehash(HASH_SEÑUELO)).toBe(false);
  });
});
