/**
 * apps/api · CAPA DE COMPOSICIÓN · Mapeo PURO EventoGrowth → EntradaObservacionReal.
 *
 * Funciones deterministas, sin efectos, sin PII: el evento M2M no transporta datos personales (sólo id de
 * evento, nombre, instante, atribución UTM y un `lead_id` opaco). El mapeo NO agrega nada personal. La clave
 * de idempotencia de la observación es provider+externalEventId. Un evento DIAG sigue siendo REAL: sólo se
 * marca como no elegible para aprendizaje.
 */
import type { EntradaObservacionReal } from '@soec/motor-medicion';
import type { NivelCalidad } from '@soec/medicion';

/** Forma del evento tal como lo entrega el endpoint M2M productivo (sin PII). */
export interface EventoGrowth {
  readonly event_id: number;
  readonly event_name: string;
  readonly occurred_at: string;
  readonly anon_id: string | null;
  readonly path: string | null;
  readonly utm_source: string | null;
  readonly utm_campaign: string | null;
  readonly value: number | null;
  readonly lead_id: number | null;
  /** Naturaleza estructural del origen: true ⇒ lead/evento de PRUEBA (SmileFlow lo marcó en la fuente). */
  readonly is_test?: boolean | null;
}

/** Calidad de la evidencia de ingesta real (valor válido de NivelCalidad). */
const CALIDAD_INGESTA: NivelCalidad = 'alta';

/**
 * True si el evento NO debe contar como evidencia comercial real (se excluye de aprendizaje/M9/Director).
 *
 * FUENTE DE VERDAD: el flag estructural `is_test` que SmileFlow persiste en el lead/evento y expone el
 * puente M2M. Un visitante público no puede fabricarlo (la captura pública siempre nace REAL; sólo el
 * token interno de testing marca TEST). Se mantienen `anon_id 'diag…'`/`utm_source 'diag'` como
 * compatibilidad auxiliar hacia atrás (marcadores heredados), nunca como única señal.
 */
export function esDiagnostico(ev: EventoGrowth): boolean {
  if (ev.is_test === true) return true;
  const anon = (ev.anon_id ?? '').toLowerCase();
  return anon.startsWith('diag') || ev.utm_source === 'diag';
}

/** Id de observación determinista = provider + externalEventId (clave de idempotencia). */
export function observacionIdDe(ev: EventoGrowth): string {
  return `smileflow-growth:${ev.event_id}`;
}

/** Mapea un evento Growth a la entrada de la puerta REAL de M8. Sin PII; ausencia de valor ⇒ conteo 1. */
export function mapearEventoGrowth(ev: EventoGrowth): EntradaObservacionReal {
  return {
    provider: 'smileflow-growth',
    externalEventId: String(ev.event_id),
    eventName: ev.event_name,
    occurredAt: ev.occurred_at,
    kpiId: ev.event_name,
    metrica: ev.event_name,
    valor: ev.value ?? 1,
    unidad: 'conteo',
    calidad: CALIDAD_INGESTA,
    cobertura: 1,
    source: 'smileflow-growth',
    utmSource: ev.utm_source,
    utmCampaign: ev.utm_campaign,
    leadRef: ev.lead_id != null ? String(ev.lead_id) : null,
    diagnostico: esDiagnostico(ev),
  };
}
