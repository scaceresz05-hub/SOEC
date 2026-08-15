/**
 * Guardarraíl de PII para el motor de adquisición, autocontenido (no depende de ramas sin fusionar).
 *
 * Rechaza que datos personales viajen hacia canales/atribución/aprendizaje: email, teléfono chileno,
 * RUT, o claves cuyo NOMBRE denota PII. Es deliberadamente conservador: ante la duda, marca PII.
 * Espeja la intención de `contienePII` de `@soec/comercio` sin acoplarse a él, para que este paquete
 * compile sobre `main`.
 */

const CLAVES_PII = new Set([
  'email',
  'correo',
  'e-mail',
  'mail',
  'telefono',
  'teléfono',
  'phone',
  'celular',
  'movil',
  'móvil',
  'rut',
  'dni',
  'nombre',
  'apellido',
  'direccion',
  'dirección',
  'address',
]);

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const RE_TELEFONO_CL = /(?:\+?56)?\s?9\s?\d{4}\s?\d{4}/;
const RE_RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}[-\s]?[0-9kK]\b/;

function valorEsPII(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return RE_EMAIL.test(v) || RE_TELEFONO_CL.test(v) || RE_RUT.test(v);
}

/**
 * ¿El objeto contiene PII, sea por el NOMBRE de una clave sensible o por el VALOR (email/teléfono/RUT)?
 */
export function contienePII(crudo: Record<string, unknown>): boolean {
  for (const [clave, valor] of Object.entries(crudo)) {
    if (CLAVES_PII.has(clave.toLowerCase())) return true;
    if (valorEsPII(valor)) return true;
  }
  return false;
}
