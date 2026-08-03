/**
 * @soec/plataforma-capacidades · dominio · REFERENCIAS opacas (M4A-1 + R-1/R-2, Art. 4 de la Directiva PCE).
 *
 * Una referencia NO es sólo "algo con esquema": debe impedir que un secreto se camufle como referencia.
 * `esReferenciaSecreto` exige un ESQUEMA de una allowlist cerrada, un path no vacío Y que el valor NO tenga
 * forma de secreto. La detección analiza el valor por SEGMENTOS (separados por `:` `/` `.` `_` `-`): una
 * referencia estructurada tiene segmentos cortos; un secreto es un segmento compacto alfanumérico largo o
 * con prefijo de token. Guardarraíl PREVENTIVO — no es un detector criptográfico ni sustituye al SecretStore;
 * nunca autoriza almacenar secretos: el dominio sólo recibe referencias lógicas. Determinista, sin red/reloj.
 */

/** Allowlist CERRADA y versionada de esquemas de referencia a secreto (referencia, NUNCA el valor). */
export const ESQUEMAS_REF: readonly string[] = ['env', 'vault', 'aws-sm', 'gcp-sm', 'azure-kv', 'secretstore', 'file', 'ref'];

const MAX_REF = 200;
const RE_SK = /\bsk-[a-z0-9-]{10,}/i; // claves estilo OpenAI (incluye variantes con guiones)
const RE_AKIA = /AKIA[0-9A-Z]{16}/; // claves AWS
const RE_BEARER = /\bbearer\s+\S/i; // "Bearer <token>"
const RE_KV = /=/; // formato clave=valor / base64 padding
const RE_WS = /\s/; // una referencia no tiene espacios
/** Un segmento que empieza con un prefijo típico de token seguido de material alfanumérico. */
const RE_PREFIJO_TOKEN = /^(token|apikey|bearer)[A-Za-z0-9]{6,}$/i;
const SEPARADORES = /[:/._-]+/;

/** ¿Un SEGMENTO parece un token? (prefijo de token, o compacto alfanumérico ≥20 con letras Y dígitos). */
function segmentoSospechoso(seg: string): boolean {
  if (!seg) return false;
  if (RE_PREFIJO_TOKEN.test(seg)) return true;
  if (seg.length >= 20 && /^[A-Za-z0-9]+$/.test(seg) && /[a-z]/i.test(seg) && /\d/.test(seg)) return true;
  return false;
}

/** ¿El valor tiene FORMA de secreto? (heurística determinista; guardarraíl conservador, no criptográfico.) */
export function pareceSecreto(v: string): boolean {
  const s = v ?? '';
  if (RE_SK.test(s) || RE_AKIA.test(s) || RE_BEARER.test(s) || RE_KV.test(s) || RE_WS.test(s)) return true;
  return s.split(SEPARADORES).some(segmentoSospechoso);
}

function esquemaDe(v: string): string | null {
  const m = v.match(/^([a-z][a-z0-9+.-]*):/i);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * ¿Es una REFERENCIA a secreto válida (Art. 4)? Esquema de la allowlist + path no vacío + acotada + SIN
 * forma de secreto. Rechaza `env:sk-…`, `vault:tokenABC…1234`, cualquier cosa con `=`/espacios, prefijos de
 * token o segmentos compactos de alta entropía. Permite referencias estructuradas (`vault:org-a/gen/main`).
 */
export function esReferenciaSecreto(v: string): boolean {
  if (!v || v.length > MAX_REF) return false;
  const esquema = esquemaDe(v);
  if (!esquema || !ESQUEMAS_REF.includes(esquema)) return false;
  const path = v.slice(esquema.length + 1);
  if (!path.trim()) return false; // path vacío (p. ej. "secretstore:") → inválido
  return !pareceSecreto(v);
}

/** ¿Es un identificador lógico acotado (proveedorRef, ids)? Sin forma de secreto. */
export function esIdentificadorLogico(v: string): boolean {
  if (!v || v.length > 128) return false;
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(v)) return false;
  return !pareceSecreto(v);
}
