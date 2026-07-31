/**
 * @soec/identity · dominio · Hash de contraseñas con scrypt (node:crypto).
 *
 * scrypt es memory-hard (reconocida por OWASP) e incorporada en Node, evitando una dependencia
 * nativa externa. Sal por contraseña (16 bytes), comparación en tiempo constante.
 *
 * Formato VERSIONADO: `scrypt$v2$N$r$p$saltHex$hashHex`. Se mantiene compatibilidad de verificación
 * con hashes `v1` antiguos (`scrypt$N$r$p$saltHex$hashHex`, N=2^14). El rehash oportunista a v2 se
 * hace en la capa de aplicación tras un login correcto (ver identity-service).
 *
 * Parámetros v2: N=2^17 (131072) — piso OWASP vigente para scrypt (r=8, p=1). A ~0.2 s por
 * operación. `maxmem` se eleva porque scrypt necesita ~128·N·r bytes (≈128 MB) por derivación.
 * Nunca texto plano ni cifrado reversible; los hashes nunca se registran ni se serializan.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { EntradaInvalidaError } from './errors';

const N = 1 << 17; // 131072
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024; // cubre 128·N·r (≈128 MB) con margen
export const VERSION_ACTUAL = 'v2';
export const LONGITUD_MINIMA = 8;
export const LONGITUD_MAXIMA = 128;

/** Valida la longitud de una contraseña ANTES de derivar (evita DoS de CPU por entradas enormes). */
export function validarLongitudPassword(plano: unknown): void {
  if (typeof plano !== 'string' || plano.length < LONGITUD_MINIMA) {
    throw new EntradaInvalidaError(`la contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres`);
  }
  if (plano.length > LONGITUD_MAXIMA) {
    throw new EntradaInvalidaError(`la contraseña no puede superar ${LONGITUD_MAXIMA} caracteres`);
  }
}

function derivar(plano: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Buffer {
  return scryptSync(plano, salt, keylen, { N: n, r, p, maxmem: MAXMEM });
}

/** Genera el hash almacenable (formato v2). Lanza EntradaInvalidaError (400) si la longitud es inválida. */
export function hashPassword(plano: string): string {
  validarLongitudPassword(plano);
  const salt = randomBytes(16);
  const hash = derivar(plano, salt, N, R, P, KEYLEN);
  return `scrypt$${VERSION_ACTUAL}$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

interface HashParseado {
  readonly version: string;
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly esperado: Buffer;
}

/** Interpreta un hash v1 (6 campos) o v2 (7 campos). Devuelve null si el formato es desconocido. */
function parsearHash(almacenado: string): HashParseado | null {
  const partes = almacenado.split('$');
  if (partes[0] !== 'scrypt') return null;
  let base: number;
  let version: string;
  if (partes.length === 7 && partes[1] === 'v2') {
    version = 'v2';
    base = 2;
  } else if (partes.length === 6) {
    version = 'v1';
    base = 1;
  } else {
    return null;
  }
  const n = Number(partes[base]);
  const r = Number(partes[base + 1]);
  const p = Number(partes[base + 2]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return null;
  const salt = Buffer.from(partes[base + 3]!, 'hex');
  const esperado = Buffer.from(partes[base + 4]!, 'hex');
  if (salt.length === 0 || esperado.length === 0) return null;
  return { version, n, r, p, salt, esperado };
}

/**
 * Verifica una contraseña contra su hash almacenado (v1 o v2), en tiempo constante. Devuelve false
 * (sin lanzar) ante formato desconocido, parámetros inválidos, o longitud de entrada fuera de rango
 * — no se ejecuta scrypt sobre entradas enormes (protección de CPU) ni se filtra información.
 */
export function verifyPassword(plano: string, almacenado: string): boolean {
  if (typeof plano !== 'string' || plano.length < LONGITUD_MINIMA || plano.length > LONGITUD_MAXIMA) {
    return false;
  }
  const h = parsearHash(almacenado);
  if (!h) return false;
  try {
    const derivado = derivar(plano, h.salt, h.n, h.r, h.p, h.esperado.length);
    return derivado.length === h.esperado.length && timingSafeEqual(derivado, h.esperado);
  } catch {
    return false;
  }
}

/** Indica si un hash debería re-derivarse a la versión/parametrización actual (v2, N/r/p vigentes). */
export function necesitaRehash(almacenado: string): boolean {
  const h = parsearHash(almacenado);
  if (!h) return true;
  return h.version !== VERSION_ACTUAL || h.n !== N || h.r !== R || h.p !== P;
}

/**
 * Hash "señuelo" ESTABLE (v2) para ejecutar una verificación de costo equivalente cuando el usuario
 * no existe o está inactivo, y así no revelar por temporización si un correo está registrado. Se
 * deriva una vez al cargar el módulo. La contraseña base es fija e irrelevante (nunca es válida para
 * ninguna cuenta real porque el hash no está asociado a ningún usuario).
 */
export const HASH_SEÑUELO: string = hashPassword('señuelo-anti-enumeracion-estable');
