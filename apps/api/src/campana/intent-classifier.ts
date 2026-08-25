/**
 * apps/api · campana · CLASIFICADOR DE INTENCIÓN de términos de búsqueda (composición, heurístico).
 *
 * Convierte términos REALES en SEÑALES DE INTENCIÓN por categoría, para que el planner opere la evidencia
 * (no sólo "hay intención competidora" → sino qué hacer). Los léxicos son GENÉRICOS de la industria dental
 * (no la identidad de ninguna organización) y son OVERRIDABLES por-org. No decide la acción: eso es del planner.
 */

export type IntentCategory =
  | 'GENERIC_SOFTWARE'       // "software dental", "administracion clinica dental" — intención de software, amplia
  | 'COMPETITOR_MANAGEMENT'  // marcas de software de gestión clínica (posibles compradores comparando)
  | 'DENTAL_TOOL'            // herramientas técnicas CAD/CAM/diagnóstico (no compran gestión clínica)
  | 'LOCAL_SERVICE'          // intención de PACIENTE buscando atención (audiencia equivocada)
  | 'IRRELEVANT_DRIFT'       // deriva fuera de intención
  | 'UNKNOWN';

export interface IntentLexicon {
  readonly managementSoftwareBrands: readonly string[];
  readonly dentalToolBrands: readonly string[];
  readonly genericSoftwareTokens: readonly string[];
  readonly patientServiceTokens: readonly string[];
}

/** Léxico por defecto de la industria dental (genérico, no específico de ninguna organización). */
export const LEXICO_DENTAL_POR_DEFECTO: IntentLexicon = {
  managementSoftwareBrands: ['dentalink', 'eaglesoft', 'dentrix', 'opendental', 'open dental', 'dentalsoft', 'denticon', 'curve dental'],
  dentalToolBrands: ['exocad', 'cariogram', 'cerec', '3shape', 'planmeca', 'dentidesk'],
  genericSoftwareTokens: ['software', 'sistema', 'programa', 'app', 'aplicacion', 'administracion', 'gestion', 'agenda', 'ficha'],
  patientServiceTokens: ['dentista', 'urgencia', 'blanqueamiento', 'implante', 'ortodoncia', 'extraccion', 'dolor'],
};

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const contieneMarca = (t: string, marcas: readonly string[]): boolean => marcas.some((m) => t.includes(norm(m)));
const contieneToken = (t: string, tokens: readonly string[]): boolean => tokens.some((k) => new RegExp(`(^|\\s)${norm(k)}`).test(t));

export function clasificarTermino(termino: string, lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): IntentCategory {
  const t = norm(termino);
  if (!t.trim()) return 'UNKNOWN';
  if (contieneMarca(t, lex.dentalToolBrands)) return 'DENTAL_TOOL';
  if (contieneMarca(t, lex.managementSoftwareBrands)) return 'COMPETITOR_MANAGEMENT';
  if (contieneToken(t, lex.genericSoftwareTokens)) return 'GENERIC_SOFTWARE';
  // "clinica dental" sin token de software y con intención de servicio ⇒ paciente.
  if (contieneToken(t, lex.patientServiceTokens)) return 'LOCAL_SERVICE';
  return 'UNKNOWN';
}

export interface IntentSignal {
  readonly category: IntentCategory;
  readonly examples: readonly string[];
  readonly impresiones: number;
  readonly clics: number;
  /** Participación de impresiones sobre el total observado (0..1). */
  readonly shareImpresiones: number;
}

export interface TerminoObservado { readonly termino: string; readonly impresiones: number; readonly clics: number }

/** Agrupa términos en señales de intención por categoría, ordenadas por impresiones desc. */
export function clasificarIntencion(terminos: readonly TerminoObservado[], lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): IntentSignal[] {
  const totalImpr = terminos.reduce((a, t) => a + t.impresiones, 0) || 1;
  const map = new Map<IntentCategory, { examples: string[]; impresiones: number; clics: number }>();
  for (const t of terminos) {
    const cat = clasificarTermino(t.termino, lex);
    const acc = map.get(cat) ?? { examples: [], impresiones: 0, clics: 0 };
    if (acc.examples.length < 5) acc.examples.push(t.termino);
    acc.impresiones += t.impresiones;
    acc.clics += t.clics;
    map.set(cat, acc);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, examples: v.examples, impresiones: v.impresiones, clics: v.clics, shareImpresiones: v.impresiones / totalImpr }))
    .sort((a, b) => b.impresiones - a.impresiones);
}
