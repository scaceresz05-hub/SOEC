/**
 * apps/api · campana · CLASIFICADOR DE INTENCIÓN de términos de búsqueda (composición, heurístico).
 *
 * Convierte términos REALES en categorías de INTENCIÓN, para que el planner opere la evidencia y decida qué
 * keyword se activa (recibe gasto) y cuál no. REGLA CONCEPTUAL clave: contener "software"/"dental" NO implica
 * intención de GESTIÓN de clínica; el software clínico/técnico (alineadores, imaging, CAD/CAM, ortodoncia) es
 * otra categoría y NO entra al grupo de gestión. Los léxicos son GENÉRICOS de la industria dental (no la
 * identidad de ninguna organización) y OVERRIDABLES por-org. No decide la acción: eso es del planner.
 */

export type IntentCategory =
  | 'CLINIC_MANAGEMENT_INTENT'      // software de GESTIÓN/administración de la clínica (comprador objetivo)
  | 'COMPETITOR_MANAGEMENT_INTENT'  // marcas de software de gestión de la competencia (comparando)
  | 'CLINICAL_TECH_SOFTWARE'        // software clínico/técnico (alineadores, imaging, CAD/CAM, ortodoncia) — NO gestión
  | 'PATIENT_INTENT'                // intención de PACIENTE buscando atención (audiencia equivocada)
  | 'EDUCATIONAL'                   // intención informativa/educativa (no comprador)
  | 'UNKNOWN';                      // no clasificable con la evidencia (genérico ambiguo)

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface IntentLexicon {
  readonly managementSoftwareBrands: readonly string[];
  readonly clinicalTechBrands: readonly string[];
  readonly clinicalTechTokens: readonly string[];
  readonly managementTokens: readonly string[];
  readonly genericSoftwareTokens: readonly string[];
  readonly patientServiceTokens: readonly string[];
  readonly educationalTokens: readonly string[];
}

/** Léxico por defecto de la industria dental (genérico, no específico de ninguna organización). */
export const LEXICO_DENTAL_POR_DEFECTO: IntentLexicon = {
  managementSoftwareBrands: ['dentalink', 'eaglesoft', 'dentrix', 'opendental', 'open dental', 'dentalsoft', 'denticon', 'curve dental', 'gestiondent'],
  clinicalTechBrands: ['exocad', 'cariogram', 'cerec', '3shape', 'planmeca', 'dentidesk', 'archform', 'cs imaging', 'nemo studio', 'nemostudio', 'nemocast', 'invisalign', 'romexis', 'dolphin imaging'],
  clinicalTechTokens: ['alineador', 'aligner', 'imaging', 'imagen', 'radiografia', 'radiografico', 'cad', 'cam', 'ortodoncia', 'escaner', 'intraoral', 'cbct', 'diseno de sonrisa', 'setup ortodoncia'],
  managementTokens: ['gestion', 'administracion', 'administrativo', 'agenda', 'agendamiento', 'ficha clinica', 'recordatorio', 'cobranza'],
  genericSoftwareTokens: ['software', 'sistema', 'programa', 'app', 'aplicacion'],
  patientServiceTokens: ['dentista', 'urgencia', 'blanqueamiento', 'implante', 'extraccion', 'dolor de muela', 'tapadura'],
  educationalTokens: ['que es', 'como', 'curso', 'significado', 'ejemplos', 'pdf', 'gratis'],
};

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tieneMarca = (t: string, marcas: readonly string[]): boolean => marcas.some((m) => t.includes(norm(m)));
const tieneToken = (t: string, tokens: readonly string[]): boolean => tokens.some((k) => new RegExp(`(^|\\s)${norm(k).replace(/\s+/g, '\\s')}`).test(t));

export interface ClassifiedTerm {
  readonly termino: string;
  readonly impresiones: number;
  readonly clics: number;
  readonly category: IntentCategory;
  readonly confidence: Confidence;
}

/**
 * Clasifica UN término. Precedencia (de más específica a más genérica): tech clínico → competidor →
 * gestión → paciente → educativo → genérico ambiguo (UNKNOWN). Un token genérico ("software") NO basta
 * para inferir gestión.
 */
export function clasificarTermino(termino: string, lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): { category: IntentCategory; confidence: Confidence } {
  const t = norm(termino);
  if (!t.trim()) return { category: 'UNKNOWN', confidence: 'LOW' };
  if (tieneMarca(t, lex.clinicalTechBrands)) return { category: 'CLINICAL_TECH_SOFTWARE', confidence: 'HIGH' };
  if (tieneToken(t, lex.clinicalTechTokens)) return { category: 'CLINICAL_TECH_SOFTWARE', confidence: 'MEDIUM' };
  if (tieneMarca(t, lex.managementSoftwareBrands)) return { category: 'COMPETITOR_MANAGEMENT_INTENT', confidence: 'HIGH' };
  if (tieneToken(t, lex.managementTokens)) {
    const fuerte = /clinic|dental|odonto/.test(t);
    return { category: 'CLINIC_MANAGEMENT_INTENT', confidence: fuerte ? 'HIGH' : 'MEDIUM' };
  }
  if (tieneToken(t, lex.patientServiceTokens)) return { category: 'PATIENT_INTENT', confidence: 'MEDIUM' };
  if (tieneToken(t, lex.educationalTokens)) return { category: 'EDUCATIONAL', confidence: 'MEDIUM' };
  // Sólo software/dental genérico ⇒ ambiguo: NO se asume gestión. UNKNOWN (no gasta por defecto).
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

/** Agrega términos clasificados en señales por categoría (para selección de hipótesis). */
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
