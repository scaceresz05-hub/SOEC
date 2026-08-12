import { describe, expect, it } from 'vitest';
import { esDiagnostico, mapearEventoGrowth, observacionIdDe, type EventoGrowth } from '../src/ingesta/mapa-growth';

function ev(over: Partial<EventoGrowth> = {}): EventoGrowth {
  return {
    event_id: 42,
    event_name: 'demo_requested',
    occurred_at: '2026-08-08T10:00:00.000Z',
    anon_id: 'anon-xyz',
    path: '/demo',
    utm_source: 'google',
    utm_campaign: 'lanzamiento',
    value: null,
    lead_id: 7,
    ...over,
  };
}

describe('mapa-growth', () => {
  it('esDiagnostico detecta anon_id "diag…" (case-insensitive) y utm_source "diag"', () => {
    expect(esDiagnostico(ev({ anon_id: 'diag-001' }))).toBe(true);
    expect(esDiagnostico(ev({ anon_id: 'DIAGprueba' }))).toBe(true);
    expect(esDiagnostico(ev({ utm_source: 'diag' }))).toBe(true);
    expect(esDiagnostico(ev({ anon_id: 'anon-normal', utm_source: 'google' }))).toBe(false);
    expect(esDiagnostico(ev({ anon_id: null, utm_source: null }))).toBe(false);
  });

  it('observacionIdDe = provider:externalEventId', () => {
    expect(observacionIdDe(ev({ event_id: 99 }))).toBe('smileflow-growth:99');
  });

  it('mapea demo_requested a EntradaObservacionReal correcta, valor 1 por defecto, sin PII', () => {
    const e = mapearEventoGrowth(ev());
    expect(e.provider).toBe('smileflow-growth');
    expect(e.externalEventId).toBe('42');
    expect(e.eventName).toBe('demo_requested');
    expect(e.kpiId).toBe('demo_requested');
    expect(e.metrica).toBe('demo_requested');
    expect(e.occurredAt).toBe('2026-08-08T10:00:00.000Z');
    expect(e.valor).toBe(1); // value null ⇒ conteo 1
    expect(e.unidad).toBe('conteo');
    expect(e.calidad).toBe('alta');
    expect(e.cobertura).toBe(1);
    expect(e.source).toBe('smileflow-growth');
    expect(e.utmSource).toBe('google');
    expect(e.utmCampaign).toBe('lanzamiento');
    expect(e.leadRef).toBe('7');
    expect(e.diagnostico).toBe(false);
    // sin PII: no se copia path ni anon_id a la entrada
    const asStr = JSON.stringify(e);
    expect(asStr).not.toContain('/demo');
    expect(asStr).not.toContain('anon-xyz');
  });

  it('respeta value explícito y marca diagnostico cuando corresponde', () => {
    const e = mapearEventoGrowth(ev({ value: 250, anon_id: 'diag-9', lead_id: null }));
    expect(e.valor).toBe(250);
    expect(e.diagnostico).toBe(true);
    expect(e.leadRef).toBeNull();
  });
});
