/**
 * apps/api · V2-B · CONTENT POLICY. Guardarraíl determinista para todo copy/creatividad ANTES de proponer.
 * Bloquea: claims clínicos/absolutos no sustentados, precios/descuentos inventados, PII, secretos y contenido
 * de otro tenant. No depende de LLM. Todo texto de campaña pasa por aquí.
 */

export type TipoViolacion =
  | 'CLAIM_NO_SUSTENTADO'
  | 'SUPERLATIVO_ABSOLUTO'
  | 'PRECIO_O_DESCUENTO_INVENTADO'
  | 'PII'
  | 'SECRETO'
  | 'CROSS_TENANT';

export interface Violacion {
  readonly tipo: TipoViolacion;
  readonly detalle: string;
}

export interface ContenidoAValidar {
  readonly organizationId: string;
  readonly textos: readonly string[]; // headline, primaryText, description, cta, etc.
}

export interface ResultadoContentPolicy {
  readonly permitido: boolean;
  readonly violaciones: readonly Violacion[];
}

const CLAIMS_NO_SUSTENTADOS = [/\bcura\b/i, /\bcuramos\b/i, /garant[ií]a?\b/i, /garantiza/i, /\bsin dolor\b/i, /100%/i, /resultado[s]? asegurado/i, /indoloro/i, /\bmilagro/i];
const SUPERLATIVOS = [/\bel mejor\b/i, /\blos mejores\b/i, /\bla mejor\b/i, /\bnúmero 1\b/i, /\bn[º°]\s*1\b/i, /\búnico[s]?\b/i, /\blíder\b/i];
const PRECIO_DESCUENTO = [/\$\s?\d/i, /\b\d+\s?%/i, /\bgratis\b/i, /\bdescuento/i, /\boferta\b/i, /\bpromoci[oó]n/i, /\b2x1\b/i, /\bcuotas\b/i];
const PII = [/[\w.+-]+@[\w-]+\.[\w.-]+/i, /\b(?:\+?56)?\s?9\s?\d{4}\s?\d{4}\b/, /\b\d{7,8}-[\dkK]\b/]; // email, teléfono CL, RUT
const SECRETO = [/eaab[a-z0-9]/i, /access_token/i, /secret/i, /bearer\s+[a-z0-9]/i];

export function validarContenido(c: ContenidoAValidar, tenantAutorizado: string): ResultadoContentPolicy {
  const violaciones: Violacion[] = [];
  if (c.organizationId !== tenantAutorizado) violaciones.push({ tipo: 'CROSS_TENANT', detalle: `contenido de ${c.organizationId} no puede usarse en ${tenantAutorizado}` });
  const texto = c.textos.join(' \n ');
  const chequear = (patrones: RegExp[], tipo: TipoViolacion, detalle: string) => {
    if (patrones.some((p) => p.test(texto))) violaciones.push({ tipo, detalle });
  };
  chequear(CLAIMS_NO_SUSTENTADOS, 'CLAIM_NO_SUSTENTADO', 'evita afirmaciones clínicas/garantías no sustentadas');
  chequear(SUPERLATIVOS, 'SUPERLATIVO_ABSOLUTO', 'evita superlativos absolutos sin evidencia (el mejor, número 1, único)');
  chequear(PRECIO_DESCUENTO, 'PRECIO_O_DESCUENTO_INVENTADO', 'no incluir precios/descuentos: SOEC no tiene datos comerciales conectados');
  chequear(PII, 'PII', 'no incluir datos personales (email/teléfono/RUT) en el copy');
  chequear(SECRETO, 'SECRETO', 'no incluir tokens/secretos');
  return { permitido: violaciones.length === 0, violaciones };
}
