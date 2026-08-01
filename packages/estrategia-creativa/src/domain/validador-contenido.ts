/**
 * @soec/estrategia-creativa · dominio · VALIDADOR SEMÁNTICO del contenido comercial generado (A-3).
 *
 * La validación estructural (esquema/longitud) NO garantiza honestidad: el cuerpo podría afirmar precios,
 * descuentos, garantías, superlativos, testimonios, certificaciones o promesas clínicas/financieras sin
 * respaldo. Este validador escanea el TEXTO generado contra un catálogo de afirmaciones de riesgo y contra
 * la política del artefacto (afirmacionesPermitidas, restricciones, pruebaSocialPermitida). Ninguna pieza
 * es aprobable/publicable-simulada si contiene una afirmación no respaldada. Determinista, sin red.
 */

export type ResultadoValidacion = 'VALIDO' | 'INVALIDO' | 'REQUIERE_REVISION';

export type TipoCifra = 'CLIENTES' | 'CLINICAS' | 'PACIENTES' | 'EMPRESAS' | 'PROFESIONALES';

/** Una cifra comercial respaldada por evidencia (A-3): tipo + valor EXACTO + id de evidencia. */
export interface CifraPermitida {
  readonly tipo: TipoCifra;
  readonly valor: number;
  readonly evidenciaId: string;
}

export interface EntradaValidacionContenido {
  readonly cuerpo: string;
  readonly afirmacionesPermitidas: readonly string[];
  readonly restricciones: readonly string[];
  readonly pruebaSocialPermitida: boolean;
  /** Integraciones REALMENTE respaldadas (A-3). Vacío ⇒ cualquier afirmación de integración es inválida. */
  readonly integracionesPermitidas?: readonly string[];
  /** Cifras comerciales respaldadas por evidencia (A-3). Vacío ⇒ cualquier cifra de clientes es inválida. */
  readonly cifrasPermitidas?: readonly CifraPermitida[];
}

/** Categorías de rechazo (A-3), para trazabilidad del veredicto. */
export type CategoriaRechazo =
  | 'PRECIO'
  | 'DESCUENTO'
  | 'GARANTIA'
  | 'SUPERLATIVO'
  | 'PRUEBA_SOCIAL'
  | 'CERTIFICACION'
  | 'PROMESA_CLINICA'
  | 'PROMESA_FINANCIERA'
  | 'RESTRICCION_VIOLADA'
  | 'INTEGRACION_NO_RESPALDADA'
  | 'COMPATIBILIDAD_UNIVERSAL'
  | 'CIFRA_NO_RESPALDADA'
  | 'CIFRA_CONTRADICTORIA';

export interface VeredictoContenido {
  readonly resultado: ResultadoValidacion;
  readonly razones: readonly string[];
  readonly categorias: readonly CategoriaRechazo[];
  readonly afirmacionesDetectadas: readonly string[];
  readonly afirmacionesNoRespaldadas: readonly string[];
  readonly restriccionesVioladas: readonly string[];
  readonly evidenciaFaltante: readonly string[];
}

/** Patrones de afirmaciones de RIESGO (no respaldables sin evidencia). Deterministas, insensibles a mayúsculas. */
const PATRONES: readonly { readonly clase: string; readonly re: RegExp; readonly requierePruebaSocial?: boolean }[] = [
  // Precios / descuentos / gratuidad
  { clase: 'precio', re: /(\$|\bclp\b|\busd\b|€|\beuros?\b|\bpesos\b)\s*\d/i },
  { clase: 'precio', re: /\b\d+\s*(pesos|clp|usd|d[oó]lares|euros)\b/i },
  { clase: 'descuento', re: /\b\d+\s*%\s*(de\s+)?(descuento|off|menos)/i },
  { clase: 'descuento', re: /\b(descuento|promoci[oó]n|oferta|rebaja|liquidaci[oó]n|gratis|sin costo)\b/i },
  // Garantías / resultados asegurados
  { clase: 'garantia', re: /\b(garantizad[oa]s?|garant[ií]a\s+de\s+resultados?|resultados?\s+garantizad|sin\s+riesgo|100\s*%|asegurad[oa]s?\s+resultado)/i },
  // Superlativos / comparaciones absolutas
  { clase: 'superlativo', re: /\b(el|la|los|las)\s+mejor(es)?\b/i },
  { clase: 'superlativo', re: /\b(n[uú]mero\s+uno|#\s*1|l[ií]der\s+(del|en\s+el)\s+mercado|[uú]nico\s+en|el\s+m[aá]s\s+\w+\s+del\s+mercado)\b/i },
  // Prueba social / testimonios
  { clase: 'prueba_social', re: /"[^"]{6,}"\s*[—\-–]\s*[A-ZÁÉÍÓÚ]/, requierePruebaSocial: true },
  { clase: 'prueba_social', re: /\b(testimonio|nuestros\s+clientes\s+dicen|rese[ñn]as?|\d+\s*estrellas|calificaci[oó]n\s+de\s+\d)/i, requierePruebaSocial: true },
  { clase: 'prueba_social', re: /\b\+?\d{2,}\s+(clientes|pacientes|cl[ií]nicas)\s+(satisfech|felices|conf[ií]an)/i, requierePruebaSocial: true },
  // Certificaciones / avales / cifras de clientes
  { clase: 'certificacion', re: /\b(certificad[oa]s?\s+por|avalad[oa]s?\s+por|aprobad[oa]\s+por\s+la?\s+\w+|acreditad[oa])/i },
  // Promesas clínicas / financieras
  { clase: 'promesa_clinica', re: /\b(cura\s+\w+|elimina\s+el\s+dolor|sin\s+dolor\s+garantizado|resultados?\s+cl[ií]nicos?\s+garantizad)/i },
  { clase: 'promesa_financiera', re: /\b(rentabilidad\s+garantizada|retorno\s+asegurado|duplica\s+tus\s+(ingresos|ventas)\s+garantiz)/i },
];

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** ¿La afirmación detectada está explícitamente permitida (whitelist con procedencia)? */
function estaPermitida(fragmento: string, permitidas: readonly string[]): boolean {
  const f = normalizar(fragmento);
  return permitidas.some((p) => {
    const np = normalizar(p);
    return np.length > 0 && (np.includes(f) || f.includes(np));
  });
}

const CATEGORIA_DE_CLASE: Record<string, CategoriaRechazo> = {
  precio: 'PRECIO', descuento: 'DESCUENTO', garantia: 'GARANTIA', superlativo: 'SUPERLATIVO',
  prueba_social: 'PRUEBA_SOCIAL', certificacion: 'CERTIFICACION', promesa_clinica: 'PROMESA_CLINICA',
  promesa_financiera: 'PROMESA_FINANCIERA',
};

/** Verbos que implican INTEGRACIÓN con un sistema/proveedor externo (A-3). Captura el objetivo tras "con". */
const RE_INTEGRACION = /\b(nos integramos con|se integra con|integraci[oó]n con|compatible con|funciona con|conecta con|sincroniza con)\s+([^.,;:!?\n]+)/gi;
/** El objetivo es una COMPATIBILIDAD UNIVERSAL (siempre inválida). */
const RE_UNIVERSAL = /^(todos?|todas?|cualquier\w*|cada)\b|\b(todo\s+el\s+mercado|del\s+mercado)\b/i;
/** El objetivo es un ACTIVO PROPIO del usuario (no un sistema externo) → no es afirmación de integración. */
const RE_ACTIVO_PROPIO = /^(tu|su|mi|nuestra|nuestro|esta|este|esa|ese|la\s+propia|el\s+propio)\b/i;
/** Cifras comerciales de clientes/pacientes/clínicas/empresas/profesionales (A-3). */
const RE_CIFRA = /\b(\+|m[aá]s\s+de|mas\s+de|sobre|hasta|cerca\s+de|over)?\s*(\d[\d.,]*)\s+(clientes|cl[ií]nicas|pacientes|empresas|profesionales)\b/gi;

const TIPO_DE_SUSTANTIVO: Record<string, TipoCifra> = { clientes: 'CLIENTES', clinicas: 'CLINICAS', pacientes: 'PACIENTES', empresas: 'EMPRESAS', profesionales: 'PROFESIONALES' };

function aNumero(s: string): number {
  return parseInt(s.replace(/[.,]/g, ''), 10);
}

/**
 * Valida el cuerpo generado. INVALIDO si contiene una afirmación de riesgo no respaldada (o prueba social
 * cuando no está permitida, o viola una restricción explícita). REQUIERE_REVISION si el cuerpo es vacío/
 * demasiado pobre. VALIDO en otro caso. Nunca "confía" en el texto: sólo pasa lo que no dispara riesgos.
 */
export function validarContenidoComercial(e: EntradaValidacionContenido): VeredictoContenido {
  const razones: string[] = [];
  const detectadas: string[] = [];
  const noRespaldadas: string[] = [];
  const restriccionesVioladas: string[] = [];
  const categorias: CategoriaRechazo[] = [];
  const cuerpo = e.cuerpo ?? '';
  const integracionesPermitidas = e.integracionesPermitidas ?? [];
  const cifrasPermitidas = e.cifrasPermitidas ?? [];

  if (!cuerpo.trim()) {
    return { resultado: 'REQUIERE_REVISION', razones: ['el cuerpo está vacío'], categorias: [], afirmacionesDetectadas: [], afirmacionesNoRespaldadas: [], restriccionesVioladas: [], evidenciaFaltante: ['cuerpo'] };
  }

  for (const p of PATRONES) {
    const m = cuerpo.match(p.re);
    if (!m) continue;
    const fragmento = m[0].trim();
    detectadas.push(`${p.clase}: "${fragmento}"`);
    if (p.requierePruebaSocial && !e.pruebaSocialPermitida) {
      noRespaldadas.push(`${p.clase}: "${fragmento}"`);
      razones.push(`prueba social no permitida (sin evidencia): "${fragmento}"`);
      categorias.push('PRUEBA_SOCIAL');
      continue;
    }
    if (!estaPermitida(fragmento, e.afirmacionesPermitidas)) {
      noRespaldadas.push(`${p.clase}: "${fragmento}"`);
      razones.push(`afirmación de ${p.clase} sin respaldo: "${fragmento}"`);
      const cat = CATEGORIA_DE_CLASE[p.clase];
      if (cat) categorias.push(cat);
    }
  }

  // A-3 · INTEGRACIONES: cada afirmación de integración con un sistema externo debe estar respaldada;
  // la compatibilidad universal se rechaza siempre; los activos propios del usuario no cuentan.
  for (const m of cuerpo.matchAll(RE_INTEGRACION)) {
    const objetivo = (m[2] ?? '').trim();
    if (!objetivo || RE_ACTIVO_PROPIO.test(objetivo)) continue; // "compatible con tu identidad visual" → no es sistema
    const frag = m[0].trim();
    if (RE_UNIVERSAL.test(objetivo)) {
      noRespaldadas.push(`compatibilidad_universal: "${frag}"`);
      razones.push(`compatibilidad universal no admisible: "${frag}"`);
      categorias.push('COMPATIBILIDAD_UNIVERSAL');
    } else if (!estaPermitida(objetivo, integracionesPermitidas)) {
      noRespaldadas.push(`integracion_no_respaldada: "${frag}"`);
      razones.push(`integración no respaldada (no está en integracionesPermitidas): "${frag}"`);
      categorias.push('INTEGRACION_NO_RESPALDADA');
    }
  }

  // A-3 · CIFRAS: cifras de clientes/pacientes/clínicas/empresas/profesionales sólo admisibles con evidencia
  // del MISMO tipo y valor EXACTO (los aproximados "más de N" nunca se admiten automáticamente).
  for (const m of cuerpo.matchAll(RE_CIFRA)) {
    const aproximador = (m[1] ?? '').trim();
    const valor = aNumero(m[2] ?? '0');
    const sustantivo = normalizar(m[3] ?? '');
    const tipo = TIPO_DE_SUSTANTIVO[sustantivo];
    if (!tipo || !Number.isFinite(valor)) continue;
    const frag = m[0].trim();
    const permitida = cifrasPermitidas.find((c) => c.tipo === tipo);
    if (!permitida) {
      noRespaldadas.push(`cifra_no_respaldada: "${frag}"`);
      razones.push(`cifra de ${tipo} sin evidencia respaldada: "${frag}"`);
      categorias.push('CIFRA_NO_RESPALDADA');
    } else if (aproximador !== '' || valor !== permitida.valor) {
      noRespaldadas.push(`cifra_contradictoria: "${frag}"`);
      razones.push(`cifra de ${tipo} contradice la evidencia (respaldado: ${permitida.valor}${aproximador ? '; no se admiten aproximados' : ''}): "${frag}"`);
      categorias.push('CIFRA_CONTRADICTORIA');
    }
  }

  // Restricciones explícitas: si el cuerpo contiene un término restringido, se marca (revisión/bloqueo).
  for (const r of e.restricciones) {
    const nr = normalizar(r);
    if (nr && normalizar(cuerpo).includes(nr)) {
      restriccionesVioladas.push(r);
      razones.push(`el cuerpo toca una restricción declarada: "${r}"`);
      categorias.push('RESTRICCION_VIOLADA');
    }
  }

  const resultado: ResultadoValidacion = noRespaldadas.length > 0 || restriccionesVioladas.length > 0 ? 'INVALIDO' : 'VALIDO';
  return { resultado, razones, categorias, afirmacionesDetectadas: detectadas, afirmacionesNoRespaldadas: noRespaldadas, restriccionesVioladas, evidenciaFaltante: [] };
}
