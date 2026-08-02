/**
 * @soec/plataforma-capacidades · dominio · REFERENCIAS opacas (M4A-1, Art. 4 de la Directiva PCE).
 *
 * Una referencia NO es sólo "algo con esquema": debe impedir que un secreto se camufle como referencia.
 * `esReferenciaSecreto` exige un ESQUEMA de una allowlist Y que el valor NO tenga forma de secreto.
 * `esIdentificadorLogico` valida `proveedorRef`/ids como referencias lógicas acotadas, sin secretos.
 * Determinista, sin red/reloj. El dominio nunca guarda ni lee el valor de un secreto.
 */

/** Esquemas admitidos para una referencia a secreto (referencia, NUNCA el valor). */
export const ESQUEMAS_REF: readonly string[] = ['env', 'vault', 'aws-sm', 'gcp-sm', 'azure-kv', 'file', 'ref'];

const MAX_REF = 200;
const RE_SK = /\bsk-[a-z0-9-]{10,}/i; // claves estilo OpenAI (incluye variantes con guiones)
const RE_AKIA = /AKIA[0-9A-Z]{16}/; // claves AWS
const RE_BEARER = /\bbearer\s+\S/i; // "Bearer <token>"
const RE_KV = /=/; // formato clave=valor / base64 padding
const RE_WS = /\s/; // una referencia no tiene espacios

/** Un token largo con letras Y dígitos parece una clave cruda embebida. */
function tokenLargoConEntropia(v: string): boolean {
  const m = v.match(/[A-Za-z0-9+/_-]{32,}/);
  if (!m) return false;
  return /[a-z]/i.test(m[0]) && /\d/.test(m[0]);
}

/** ¿El valor tiene FORMA de secreto? (heurística determinista; el guardarraíl es conservador.) */
export function pareceSecreto(v: string): boolean {
  const s = v ?? '';
  return RE_SK.test(s) || RE_AKIA.test(s) || RE_BEARER.test(s) || RE_KV.test(s) || RE_WS.test(s) || tokenLargoConEntropia(s);
}

function esquemaDe(v: string): string | null {
  const m = v.match(/^([a-z][a-z0-9+.-]*):/i);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * ¿Es una REFERENCIA a secreto válida (Art. 4)? Esquema de la allowlist + acotada + SIN forma de secreto.
 * Rechaza `env:sk-…`, `vault:AKIA…`, cualquier cosa con `=`/espacios o un token largo de alta entropía.
 */
export function esReferenciaSecreto(v: string): boolean {
  if (!v || v.length > MAX_REF) return false;
  const esquema = esquemaDe(v);
  if (!esquema || !ESQUEMAS_REF.includes(esquema)) return false;
  return !pareceSecreto(v);
}

/** ¿Es un identificador lógico acotado (proveedorRef, ids)? Sin forma de secreto. */
export function esIdentificadorLogico(v: string): boolean {
  if (!v || v.length > 128) return false;
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(v)) return false;
  return !pareceSecreto(v);
}
