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

export interface EntradaValidacionContenido {
  readonly cuerpo: string;
  readonly afirmacionesPermitidas: readonly string[];
  readonly restricciones: readonly string[];
  readonly pruebaSocialPermitida: boolean;
}

export interface VeredictoContenido {
  readonly resultado: ResultadoValidacion;
  readonly razones: readonly string[];
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
  const cuerpo = e.cuerpo ?? '';

  if (!cuerpo.trim()) {
    return { resultado: 'REQUIERE_REVISION', razones: ['el cuerpo está vacío'], afirmacionesDetectadas: [], afirmacionesNoRespaldadas: [], restriccionesVioladas: [], evidenciaFaltante: ['cuerpo'] };
  }

  for (const p of PATRONES) {
    const m = cuerpo.match(p.re);
    if (!m) continue;
    const fragmento = m[0].trim();
    detectadas.push(`${p.clase}: "${fragmento}"`);
    if (p.requierePruebaSocial && !e.pruebaSocialPermitida) {
      noRespaldadas.push(`${p.clase}: "${fragmento}"`);
      razones.push(`prueba social no permitida (sin evidencia): "${fragmento}"`);
      continue;
    }
    // Precio/descuento/garantía/superlativo/certificación/promesa: sólo admisible si está explícitamente
    // en las afirmaciones permitidas (con procedencia). En modo simulado no lo están → no respaldada.
    if (!estaPermitida(fragmento, e.afirmacionesPermitidas)) {
      noRespaldadas.push(`${p.clase}: "${fragmento}"`);
      razones.push(`afirmación de ${p.clase} sin respaldo: "${fragmento}"`);
    }
  }

  // Restricciones explícitas: si el cuerpo contiene un término restringido, se marca (revisión/bloqueo).
  for (const r of e.restricciones) {
    const nr = normalizar(r);
    if (nr && normalizar(cuerpo).includes(nr)) {
      restriccionesVioladas.push(r);
      razones.push(`el cuerpo toca una restricción declarada: "${r}"`);
    }
  }

  const resultado: ResultadoValidacion = noRespaldadas.length > 0 || restriccionesVioladas.length > 0 ? 'INVALIDO' : 'VALIDO';
  return { resultado, razones, afirmacionesDetectadas: detectadas, afirmacionesNoRespaldadas: noRespaldadas, restriccionesVioladas, evidenciaFaltante: [] };
}
