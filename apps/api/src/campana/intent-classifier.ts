/**
 * apps/api · campana · CLASIFICADOR DE INTENCIÓN de términos de búsqueda (composición, heurístico).
 *
 * Reglas conceptuales REUTILIZABLES (no listas exclusivas ni identidad de ninguna organización):
 *  - Contener "software"/"dental" NO implica GESTIÓN; y "software para dentistas" NO es intención de PACIENTE.
 *  - Una marca de competidor NO implica intención COMPRADORA: se sub-clasifica por señales (comprador vs
 *    navegacional vs institucional/educativo vs desconocido). Sólo el comprador puede recibir gasto.
 *  - Lo desconocido NO se paga por descubrir.
 * Léxicos genéricos de la industria dental + señales de intención, OVERRIDABLES por-org.
 */

export type IntentCategory =
  | 'CLINIC_MANAGEMENT_INTENT'
  | 'COMPETITOR_BUYER_INTENT'
  | 'COMPETITOR_NAVIGATIONAL'
  | 'COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL'
  | 'COMPETITOR_UNKNOWN'
  | 'CLINICAL_TECH_SOFTWARE'
  | 'PATIENT_INTENT'
  | 'EDUCATIONAL'
  | 'UNKNOWN';

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface IntentLexicon {
  readonly managementSoftwareBrands: readonly string[];
  readonly clinicalTechBrands: readonly string[];
  readonly clinicalTechTokens: readonly string[];
  readonly managementTokens: readonly string[];
  readonly genericSoftwareTokens: readonly string[];
  readonly professionalDentalTokens: readonly string[];
  readonly patientServiceTokens: readonly string[];
  readonly educationalTokens: readonly string[];
  readonly buyerSignals: readonly string[];
  readonly navigationalSignals: readonly string[];
  readonly institutionalSignals: readonly string[];
}

/** Léxico por defecto de la industria dental (genérico, no específico de ninguna organización). */
export const LEXICO_DENTAL_POR_DEFECTO: IntentLexicon = {
  managementSoftwareBrands: ['dentalink', 'eaglesoft', 'dentrix', 'opendental', 'open dental', 'dentalsoft', 'denticon', 'curve dental', 'gestiondent'],
  clinicalTechBrands: ['exocad', 'cariogram', 'cerec', '3shape', 'planmeca', 'dentidesk', 'archform', 'cs imaging', 'nemo studio', 'nemostudio', 'nemocast', 'invisalign', 'romexis', 'dolphin imaging'],
  clinicalTechTokens: ['alineador', 'aligner', 'imaging', 'imagen', 'radiografia', 'radiografico', 'cad', 'cam', 'ortodoncia', 'escaner', 'intraoral', 'cbct', 'diseno de sonrisa', 'setup ortodoncia'],
  managementTokens: ['gestion', 'administracion', 'administrativo', 'agenda', 'agendamiento', 'ficha clinica', 'recordatorio', 'cobranza'],
  genericSoftwareTokens: ['software', 'sistema', 'programa', 'app', 'aplicacion', 'plataforma'],
  // Sustantivos de AUDIENCIA profesional (no el adjetivo genérico "dental"): "software para dentistas" = gestión,
  // pero "software dental" (sólo adjetivo) queda ambiguo (UNKNOWN, sin gasto).
  professionalDentalTokens: ['clinica', 'odontolog', 'dentista', 'dentistas', 'consulta dental'],
  patientServiceTokens: ['urgencia', 'blanqueamiento', 'implante', 'extraccion', 'dolor de muela', 'tapadura', 'ortodoncista cerca', 'hora dentista'],
  educationalTokens: ['que es', 'como', 'curso', 'significado', 'ejemplos', 'pdf', 'gratis', 'tutorial', 'manual'],
  buyerSignals: ['precio', 'precios', 'plan', 'planes', 'demo', 'software', 'alternativa', 'alternativas', 'comparar', 'comparacion', 'vs', 'como funciona', 'opiniones', 'reseñas', 'reviews', 'cotizacion', 'contratar'],
  navigationalSignals: ['login', 'ingreso', 'iniciar sesion', 'inicio sesion', 'usuario', 'www', '.cl', '.com', 'acceso', 'portal', 'entrar', 'descargar app'],
  institutionalSignals: ['universidad', 'instituto', 'institucion', 'campus', 'facultad', 'uchile', 'uach', 'inacap', 'duoc', 'ucn', 'udec', 'usach', 'puc', 'u de', 'sede'],
};

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tieneMarca = (t: string, marcas: readonly string[]): boolean => marcas.some((m) => t.includes(norm(m)));
const tieneToken = (t: string, tokens: readonly string[]): boolean => tokens.some((k) => { const n = norm(k); return n.startsWith('.') ? t.includes(n) : new RegExp(`(^|\\s)${n.replace(/\s+/g, '\\s')}`).test(t); });

export interface ClassifiedTerm {
  readonly termino: string;
  readonly impresiones: number;
  readonly clics: number;
  readonly category: IntentCategory;
  readonly confidence: Confidence;
}

/** Sub-clasifica una consulta que menciona una marca de competidor por su INTENCIÓN (no toda marca es comprador). */
function subClasificarCompetidor(t: string, lex: IntentLexicon): { category: IntentCategory; confidence: Confidence } {
  if (tieneToken(t, lex.institutionalSignals)) return { category: 'COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL', confidence: 'MEDIUM' };
  if (tieneToken(t, lex.navigationalSignals)) return { category: 'COMPETITOR_NAVIGATIONAL', confidence: 'MEDIUM' };
  if (tieneToken(t, lex.buyerSignals)) return { category: 'COMPETITOR_BUYER_INTENT', confidence: 'HIGH' };
  return { category: 'COMPETITOR_UNKNOWN', confidence: 'LOW' }; // marca sola / sin señal ⇒ no se paga por descubrir
}

/**
 * Clasifica UN término. Precedencia: tech clínico → competidor(sub) → gestión → software-para-profesional →
 * paciente → educativo → genérico ambiguo (UNKNOWN). Un token genérico ("software") NO infiere gestión, y la
 * intención de PACIENTE se descarta si la consulta menciona software/sistema (los pacientes no buscan software).
 */
export function clasificarTermino(termino: string, lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): { category: IntentCategory; confidence: Confidence } {
  const t = norm(termino);
  if (!t.trim()) return { category: 'UNKNOWN', confidence: 'LOW' };
  if (tieneMarca(t, lex.clinicalTechBrands)) return { category: 'CLINICAL_TECH_SOFTWARE', confidence: 'HIGH' };
  if (tieneToken(t, lex.clinicalTechTokens)) return { category: 'CLINICAL_TECH_SOFTWARE', confidence: 'MEDIUM' };
  if (tieneMarca(t, lex.managementSoftwareBrands)) return subClasificarCompetidor(t, lex);
  if (tieneToken(t, lex.managementTokens)) {
    const fuerte = /clinic|dental|odonto/.test(t);
    return { category: 'CLINIC_MANAGEMENT_INTENT', confidence: fuerte ? 'HIGH' : 'MEDIUM' };
  }
  const tieneSoftware = tieneToken(t, lex.genericSoftwareTokens);
  const contextoProfesional = tieneToken(t, lex.professionalDentalTokens);
  // "software para dentistas/clínica" ⇒ software PARA el profesional = gestión (baja confianza), NUNCA paciente.
  if (tieneSoftware && contextoProfesional) return { category: 'CLINIC_MANAGEMENT_INTENT', confidence: 'LOW' };
  // Paciente sólo si NO hay señal de software (los pacientes no buscan "software").
  if (!tieneSoftware && tieneToken(t, lex.patientServiceTokens)) return { category: 'PATIENT_INTENT', confidence: 'MEDIUM' };
  if (tieneToken(t, lex.educationalTokens)) return { category: 'EDUCATIONAL', confidence: 'MEDIUM' };
  return { category: 'UNKNOWN', confidence: 'LOW' };
}

export interface TerminoObservado { readonly termino: string; readonly impresiones: number; readonly clics: number }

export function clasificarTerminos(terminos: readonly TerminoObservado[], lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): ClassifiedTerm[] {
  return terminos.map((t) => { const { category, confidence } = clasificarTermino(t.termino, lex); return { ...t, category, confidence }; });
}

export interface IntentSignal {
  readonly category: IntentCategory;
  readonly examples: readonly string[];
  readonly impresiones: number;
  readonly clics: number;
  readonly shareImpresiones: number;
}

export function agregarSenales(clasificados: readonly ClassifiedTerm[]): IntentSignal[] {
  const totalImpr = clasificados.reduce((a, t) => a + t.impresiones, 0) || 1;
  const map = new Map<IntentCategory, { examples: string[]; impresiones: number; clics: number }>();
  for (const t of clasificados) {
    const acc = map.get(t.category) ?? { examples: [], impresiones: 0, clics: 0 };
    if (acc.examples.length < 6) acc.examples.push(t.termino);
    acc.impresiones += t.impresiones;
    acc.clics += t.clics;
    map.set(t.category, acc);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, examples: v.examples, impresiones: v.impresiones, clics: v.clics, shareImpresiones: v.impresiones / totalImpr }))
    .sort((a, b) => b.impresiones - a.impresiones);
}
