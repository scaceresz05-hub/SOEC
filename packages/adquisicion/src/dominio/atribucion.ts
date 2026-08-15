/**
 * AttributionEvidence — la evidencia de por qué un resultado se asocia (o no) a un canal/campaña.
 *
 * Unifica las dos vocabularios de confianza que hoy coexisten (`ClaseEvidencia` de medición,
 * `GradoAtribucion` de motor-medición, `AtribucionWeb` de comercio) en una escala de 5 niveles.
 * Regla dura, heredada de todo el sistema: **DESCONOCIDO permanece DESCONOCIDO**. Nunca se convierte
 * un UNKNOWN en "orgánico" o "directo" por conveniencia; la coincidencia temporal no es causalidad.
 */

export type NivelAtribucion = 'DIRECT' | 'OBSERVED' | 'ATTRIBUTED' | 'PROBABLE' | 'UNKNOWN';

export interface Utm {
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly content: string | null;
  readonly term: string | null;
}

export const UTM_VACIO: Utm = { source: null, medium: null, campaign: null, content: null, term: null };

export interface EvidenciaAtribucion {
  readonly provider: string | null;
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly adset: string | null;
  readonly ad: string | null;
  readonly creative: string | null;
  readonly utm: Utm;
  readonly clickId: string | null;
  readonly landingPage: string | null;
  readonly sessionRef: string | null;
  readonly nivel: NivelAtribucion;
  readonly observedAt: string | null;
}

export const ATRIBUCION_DESCONOCIDA: EvidenciaAtribucion = {
  provider: null,
  source: null,
  medium: null,
  campaign: null,
  adset: null,
  ad: null,
  creative: null,
  utm: UTM_VACIO,
  clickId: null,
  landingPage: null,
  sessionRef: null,
  nivel: 'UNKNOWN',
  observedAt: null,
};

/**
 * Deriva el nivel de atribución a partir de la evidencia disponible, de forma conservadora:
 *   · DIRECT   — hay clickId del proveedor (gclid/fbclid) o id de campaña propio verificable;
 *   · ATTRIBUTED — hay UTM de campaña coherente;
 *   · OBSERVED — hay señal de canal (source/medium) pero sin campaña;
 *   · PROBABLE — sólo hay landing/sesión que sugiere un canal, sin señal directa;
 *   · UNKNOWN  — nada demostrable. NUNCA se promueve a orgánico/directo.
 * Esta función jamás inventa un nivel superior al que la evidencia sostiene.
 */
export function clasificarNivelAtribucion(ev: Omit<EvidenciaAtribucion, 'nivel'>): NivelAtribucion {
  if (ev.clickId !== null && ev.clickId.trim() !== '') return 'DIRECT';
  if (ev.campaign !== null && ev.campaign.trim() !== '') return 'ATTRIBUTED';
  if (ev.utm.campaign !== null && ev.utm.campaign.trim() !== '') return 'ATTRIBUTED';
  const haySenalCanal =
    (ev.source !== null && ev.source.trim() !== '') || (ev.utm.source !== null && ev.utm.source.trim() !== '');
  if (haySenalCanal) return 'OBSERVED';
  const hayPista = ev.landingPage !== null || ev.sessionRef !== null;
  if (hayPista) return 'PROBABLE';
  return 'UNKNOWN';
}

export function conNivelDerivado(ev: Omit<EvidenciaAtribucion, 'nivel'>): EvidenciaAtribucion {
  return { ...ev, nivel: clasificarNivelAtribucion(ev) };
}

/** ¿La evidencia sostiene una afirmación causal sobre el canal? Sólo DIRECT/ATTRIBUTED. */
export function sostieneCanal(ev: EvidenciaAtribucion): boolean {
  return ev.nivel === 'DIRECT' || ev.nivel === 'ATTRIBUTED';
}
