/**
 * Acquisition surface (apps/api) — tests adversariales tenant-scoped y fail-closed (FASE 25-6).
 *
 * Ejercen el servicio de lectura y los adaptadores Meta sobre el registro REAL de negocios
 * (SmileFlow/CYP). Sin red, sin efectos externos.
 */
import { describe, expect, it } from 'vitest';
import { resumenDe, canalesDe, estrategiaDe, economiaDe, outcomesDe } from '../src/acquisition/acquisition-service';
import { estadoMetaDe } from '../src/acquisition/meta-read-adapter';
import { MetaWriteAdapter, EscrituraMetaBloqueadaError } from '../src/acquisition/meta-write-adapter';
import { getBusiness } from '../src/plataforma';

describe('acquisition surface · objetivo config-driven (no if org)', () => {
  it('DIRECTOR_OBJECTIVE_FIRST: el objetivo se deriva del modelo de negocio', () => {
    expect(resumenDe('org-cyp').objetivo).toBe('GENERATE_SALES'); // ECOMMERCE_DISTRIBUCION
    expect(resumenDe('org-smileflow').objetivo).toBe('GENERATE_LEADS'); // SAAS_FUNNEL
  });

  it('CYP sin medición ⇒ FOUNDATION_REQUIRED; no fabrica campaña Meta', () => {
    const r = resumenDe('org-cyp');
    expect(r.foundation).toBe('FOUNDATION_REQUIRED');
    expect(r.hipotesisCampania).toBe(0);
  });
});

describe('acquisition surface · NOT_CONNECTED ≠ ZERO y fail-closed', () => {
  it('NOT_CONNECTED_NOT_ZERO: canales Meta de CYP en NOT_CONFIGURED (no 0)', () => {
    const canales = canalesDe('org-cyp');
    const metaIg = canales.find((c) => c.canal === 'META_INSTAGRAM');
    expect(metaIg?.status).toBe('NOT_CONFIGURED');
    expect(metaIg?.readCapability).toBe(false);
    expect(metaIg?.writeCapability).toBe(false);
  });

  it('META_CHANNEL_NO_FAKE_ACCOUNT: estado Meta computado sin red, graphCalls 0', () => {
    const cyp = estadoMetaDe('org-cyp');
    expect(cyp.read).toBe('NOT_CONFIGURED');
    expect(cyp.write).toBe('NOT_READY');
    expect(cyp.accountBinding).toBe('NOT_CONFIGURED');
    expect(cyp.graphCalls).toBe(0);
    expect(estadoMetaDe('org-smileflow').read).toBe('NOT_CONFIGURED');
  });

  it('UNKNOWN_ORG_FAILS_CLOSED: getBusiness lanza para una org no registrada', () => {
    expect(() => getBusiness('org-inexistente')).toThrow();
  });
});

describe('acquisition surface · Meta write LOCKED', () => {
  it('META_WRITE_LOCKED / NO_SECRET_DENY / AUTONOMOUS_FALSE_DENY', async () => {
    const w = new MetaWriteAdapter(null); // sin binding real
    expect(w.estado()).toBe('NOT_READY');
    expect(MetaWriteAdapter.puedeEjecutarReal).toBe(false);
    await expect(
      w.ejecutarReal({ organizationId: 'org-a', tipo: 'PAID_CAMPAIGN_CREATE', adAccountId: 'act_1', pageId: null }),
    ).rejects.toBeInstanceOf(EscrituraMetaBloqueadaError);
  });

  it('META_WRITE_WRONG_TENANT_DENY: describir rechaza una cuenta fuera del confinamiento', () => {
    const w = new MetaWriteAdapter('act_autorizada');
    expect(() => w.describir({ organizationId: 'org-a', tipo: 'PAID_AD_PAUSE', adAccountId: 'act_otra', pageId: null })).toThrow(EscrituraMetaBloqueadaError);
    // La misma cuenta autorizada sí se describe (dry-run), sin enviar nada.
    expect(w.describir({ organizationId: 'org-a', tipo: 'PAID_AD_PAUSE', adAccountId: 'act_autorizada', pageId: null }).host).toBe('graph.facebook.com');
  });
});

describe('acquisition surface · economía y outcomes honestos', () => {
  it('ECONOMICS_UNKNOWN_PRESERVED: sin denominadores válidos, todo indicador es null', () => {
    const eco = economiaDe('org-cyp');
    expect(eco.indicadores.every((i) => i.valor === null)).toBe(true);
  });

  it('outcomes comerciales por modelo, disponibilidad honesta (no 0 inventado)', () => {
    const cyp = outcomesDe('org-cyp');
    expect(cyp.map((o) => o.outcome)).toContain('PURCHASE');
    expect(cyp.every((o) => o.n === null && o.disponibilidad === 'NOT_AVAILABLE')).toBe(true);
    const sf = outcomesDe('org-smileflow');
    expect(sf.map((o) => o.outcome)).toEqual(expect.arrayContaining(['LEAD', 'DEMO', 'CUSTOMER']));
  });

  it('la estrategia es SHADOW y no recomienda automáticamente', () => {
    expect(estrategiaDe('org-cyp').naturaleza).toBe('SHADOW');
    expect(estrategiaDe('org-cyp').recomendacion).toBeNull();
  });
});
