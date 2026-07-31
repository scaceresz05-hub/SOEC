/**
 * @soec/identity · dominio · Hash de contraseñas con scrypt (node:crypto).
 *
 * scrypt es memory-hard (reconocida por OWASP) e incorporada en Node, evitando una dependencia
 * nativa externa. Sal por contraseña (16 bytes), comparación en tiempo constante. Formato:
 * `scrypt$N$r$p$saltHex$hashHex`. Nunca texto plano ni cifrado reversible.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384; // costo CPU/memoria
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Genera el hash almacenable de una contraseña. */
export function hashPassword(plano: string): string {
  if (!plano || plano.length < 8) throw new Error('la contraseña debe tener al menos 8 caracteres');
  const salt = randomBytes(16);
  const hash = scryptSync(plano, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Verifica una contraseña contra su hash almacenado, en tiempo constante. */
export function verifyPassword(plano: string, almacenado: string): boolean {
  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  const salt = Buffer.from(partes[4]!, 'hex');
  const esperado = Buffer.from(partes[5]!, 'hex');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let derivado: Buffer;
  try {
    derivado = scryptSync(plano, salt, esperado.length, { N: n, r, p });
  } catch {
    return false;
  }
  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado);
}
