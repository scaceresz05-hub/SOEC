/**
 * Meta organic read — semántica de valor, sanitización de tokens y aislamiento de media (FASE 7,10,12).
 * Sin red. Tokens SINTÉTICOS (nunca reales).
 */
import { describe, expect, it } from 'vitest';
import {
  clasificarValorMetrica,
  redactarUrl,
  contieneTokenEnUrl,
  sanitizarGraph,
  sanitizarPaging,
  serializarSeguro,
  claveMedia,
  RAW_GRAPH_RESPONSE_PERSISTENCE,
  UNIDAD_WATCH_TIME,
} from '../src/acquisition/meta-organic';

const TOKEN = 'SYNTH_TOKEN_abc123XYZ'; // sintético — jamás un valor real

describe('semántica de valor — nunca null/missing/error → 0', () => {
  it('ZERO_PRESERVED: value=0 ⇒ ZERO (cero real, no ausencia)', () => {
    expect(clasificarValorMetrica({ present: true, value: 0 })).toEqual({ clase: 'ZERO', valor: 0 });
  });
  it('VALUE', () => {
    expect(clasificarValorMetrica({ present: true, value: 42 })).toEqual({ clase: 'VALUE', valor: 42 });
  });
  it('NO_DATA_PRESERVED: ausente / data:[] / null ⇒ NO_DATA (nunca 0)', () => {
    expect(clasificarValorMetrica({ present: false, value: null }).clase).toBe('NO_DATA');
    expect(clasificarValorMetrica({ present: true, value: null, emptyData: true }).clase).toBe('NO_DATA');
    expect(clasificarValorMetrica({ present: true, value: null }).clase).toBe('NO_DATA');
    for (const e of [{ present: false, value: null }, { present: true, value: null, emptyData: true }]) {
      expect(clasificarValorMetrica(e).valor).toBeNull(); // MISSING nunca se vuelve 0
    }
  });
  it('PERMISSION_MISSING / ERROR / NOT_SUPPORTED / DEPRECATED nunca son 0', () => {
    expect(clasificarValorMetrica({ present: false, value: null, errorCode: 10 }).clase).toBe('PERMISSION_MISSING');
    expect(clasificarValorMetrica({ present: false, value: null, errorCode: 99 }).clase).toBe('ERROR');
    expect(clasificarValorMetrica({ present: false, value: null, notSupported: true }).clase).toBe('NOT_SUPPORTED');
    expect(clasificarValorMetrica({ present: false, value: null, deprecated: true }).clase).toBe('DEPRECATED');
    for (const e of [{ present: false, value: null, errorCode: 10 }, { present: false, value: null, notSupported: true }]) {
      expect(clasificarValorMetrica(e).valor).toBeNull();
    }
  });
});

describe('sanitización de tokens (adversarial A–H) — tokens sintéticos', () => {
  it('C: redacta access_token preservando otros parámetros', () => {
    expect(redactarUrl(`https://graph.facebook.com/x?access_token=${TOKEN}&foo=bar`)).toBe(
      'https://graph.facebook.com/x?access_token=[REDACTED]&foo=bar',
    );
  });
  it('D: redacta appsecret_proof', () => {
    expect(redactarUrl(`https://g/x?appsecret_proof=${TOKEN}&a=1`)).toContain('appsecret_proof=[REDACTED]');
    expect(redactarUrl(`https://g/x?appsecret_proof=${TOKEN}&a=1`)).not.toContain(TOKEN);
  });
  it('E: token URL-encoded no fuga; detección no es stateful', () => {
    const url = `https://g/x?access_token=${encodeURIComponent(TOKEN + '==/+')}&m=reach`;
    expect(redactarUrl(url)).not.toContain(TOKEN);
    expect(contieneTokenEnUrl(url)).toBe(true);
    expect(contieneTokenEnUrl(url)).toBe(true); // idempotente (no lastIndex)
  });
  it('A/B: sanitizarGraph descarta paging.next/previous y conserva cursors', () => {
    const envelope = {
      data: [{ id: '1', reach: 10 }],
      paging: {
        cursors: { before: 'BEF', after: 'AFT' },
        next: `https://graph.facebook.com/v26.0/17841/insights?access_token=${TOKEN}&metric=reach`,
        previous: `https://graph.facebook.com/v26.0/17841/insights?access_token=${TOKEN}`,
      },
    };
    const s = sanitizarGraph(envelope) as { paging: unknown };
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(s.paging).toEqual({ cursors: { before: 'BEF', after: 'AFT' } });
  });
  it('F: serializarSeguro nunca emite el token en un envelope crudo', () => {
    expect(serializarSeguro({ url: `https://g?access_token=${TOKEN}`, n: 1 })).not.toContain(TOKEN);
  });
  it('G: error de Graph con URL con token queda sanitizado', () => {
    const err = { error: { message: 'failed', code: 1, trace: `https://g?access_token=${TOKEN}` } };
    expect(serializarSeguro(err)).not.toContain(TOKEN);
  });
  it('sanitizarPaging conserva sólo cursors', () => {
    expect(sanitizarPaging({ cursors: { before: 'B', after: 'A' }, next: `x?access_token=${TOKEN}` })).toEqual({
      cursors: { before: 'B', after: 'A' },
    });
  });
  it('RAW_GRAPH_RESPONSE_PERSISTENCE = FORBIDDEN', () => {
    expect(RAW_GRAPH_RESPONSE_PERSISTENCE).toBe('FORBIDDEN');
  });
});

describe('media — identidad tenant-scoped y unidades', () => {
  it('CROSS_TENANT_MEDIA_ISOLATION: mismo externalMediaId en otra org NO colisiona', () => {
    const a = claveMedia({ organizationId: 'org-smileflow', provider: 'meta', igsid: '17841432883225770', externalMediaId: 'M1' });
    const b = claveMedia({ organizationId: 'org-cyp', provider: 'meta', igsid: '17841432883225770', externalMediaId: 'M1' });
    expect(a).not.toBe(b);
    expect(a).toBe('org-smileflow:meta:17841432883225770:M1');
  });
  it('WATCH_TIME_UNIT = milliseconds (no se convierte a segundos)', () => {
    expect(UNIDAD_WATCH_TIME).toBe('milliseconds');
  });
});
