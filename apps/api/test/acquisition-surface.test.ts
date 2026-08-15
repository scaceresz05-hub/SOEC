/**
 * Acquisition surface (apps/api) — tests adversariales tenant-scoped y fail-closed (FASE 25-6).
 *
 * Ejercen el servicio de lectura VIVO (SSOT) y los adaptadores Meta sobre el registro real de
 * negocios (SmileFlow/CYP) con un store vacío: los conteos son honestos (NOT_AVAILABLE / sin datos),
 * jamás ceros inventados. Sin red, sin efectos externos.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { resumenDe, canalesDe, estrategiaDe, outcomesVivosDe } from '../src/acquisition/acquisition-service';
import { estadoMetaDe } from '../src/acquisition/meta-read-adapter';
import { MetaWriteAdapter, EscrituraMetaBloqueadaError } from '../src/acquisition/meta-write-adapter';
import { getBusiness } from '../src/plataforma';

const store = () => new InMemoryEventStore();
function ctxDe(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('test'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c-test' };
}

describe('acquisition surface · objetivo config-driven (no if org)', () => {
  it('DIRECTOR_OBJECTIVE_FIRST: el objetivo se deriva del modelo de negocio', async () => {
    expect((await resumenDe(store(), ctxDe('org-cyp'), 'org-cyp')).objetivo).toBe('GENERATE_SALES');
    expect((await resumenDe(store(), ctxDe('org-smileflow'), 'org-smileflow')).objetivo).toBe('GENERATE_LEADS');
  });

  it('CYP sin medición ⇒ FOUNDATION_REQUIRED; no fabrica campaña Meta', async () => {
    const r = await resumenDe(store(), ctxDe('org-cyp'), 'org-cyp');
    expect(r.foundation).toBe('FOUNDATION_REQUIRED');
    expect(r.hipotesisCampania).toBe(0);
  });
});

describe('acquisition surface · NOT_CONNECTED ≠ ZERO y fail-closed', () => {
  it('NOT_CONNECTED_NOT_ZERO: canales Meta de CYP en NOT_CONFIGURED (no 0)', () => {
    const metaIg = canalesDe('org-cyp').find((c) => c.canal === 'META_INSTAGRAM');
    expect(metaIg?.status).toBe('NOT_CONFIGURED');
    expect(metaIg?.readCapability).toBe(false);
    expect(metaIg?.writeCapability).toBe(false);
  });

  it('META_CHANNEL_NO_FAKE_ACCOUNT: estado Meta sin red, graphCalls 0', () => {
    const cyp = estadoMetaDe('org-cyp');
    expect(cyp.read).toBe('NOT_CONFIGURED');
    expect(cyp.write).toBe('NOT_READY');
    expect(cyp.graphCalls).toBe(0);
  });

  it('UNKNOWN_ORG_FAILS_CLOSED: getBusiness lanza para una org no registrada', () => {
    expect(() => getBusiness('org-inexistente')).toThrow();
  });
});

describe('acquisition surface · Meta write LOCKED', () => {
  it('META_WRITE_LOCKED / NO_SECRET_DENY / AUTONOMOUS_FALSE_DENY', async () => {
    const w = new MetaWriteAdapter(null);
    expect(w.estado()).toBe('NOT_READY');
    expect(MetaWriteAdapter.puedeEjecutarReal).toBe(false);
    await expect(w.ejecutarReal({ organizationId: 'org-a', tipo: 'PAID_CAMPAIGN_CREATE', adAccountId: 'act_1', pageId: null })).rejects.toBeInstanceOf(EscrituraMetaBloqueadaError);
  });

  it('META_WRITE_WRONG_TENANT_DENY: describir rechaza cuenta fuera del confinamiento', () => {
    const w = new MetaWriteAdapter('act_autorizada');
    expect(() => w.describir({ organizationId: 'org-a', tipo: 'PAID_AD_PAUSE', adAccountId: 'act_otra', pageId: null })).toThrow(EscrituraMetaBloqueadaError);
    expect(w.describir({ organizationId: 'org-a', tipo: 'PAID_AD_PAUSE', adAccountId: 'act_autorizada', pageId: null }).host).toBe('graph.facebook.com');
  });
});

describe('acquisition surface · economía y outcomes honestos (store vacío)', () => {
  it('CYP: PURCHASE NOT_AVAILABLE con store vacío (no 0 inventado); economía sin números falsos', async () => {
    const v = await outcomesVivosDe(store(), ctxDe('org-cyp'), 'org-cyp');
    const purchase = v.outcomes.find((o) => o.outcome === 'PURCHASE');
    expect(purchase?.status).toBe('NOT_AVAILABLE');
    expect(purchase?.value).toBeNull();
    expect(v.economia.every((i) => i.valor === null)).toBe(true);
    // Ninguna es un $0 falso: ROAS/MER/CAC quedan NOT_APPLICABLE.
    expect(v.economia.map((i) => i.disponibilidad)).toEqual(expect.arrayContaining(['NOT_APPLICABLE']));
  });

  it('CYP_MARGIN_REMAINS_UNKNOWN / CYP_ORDERS_DO_NOT_GAIN_FAKE_ATTRIBUTION', async () => {
    const v = await outcomesVivosDe(store(), ctxDe('org-cyp'), 'org-cyp');
    expect(v.atribucion.estado).toBe('UNKNOWN');
    expect(v.atribucion.humano).toContain('no sabemos qué canal');
    // No hay ROAS con valor (sin ingreso atribuido).
    expect(v.economia.find((i) => i.nombre === 'ROAS')?.disponibilidad).toBe('NOT_APPLICABLE');
  });

  it('SmileFlow: leads/demos test-excluidos (store vacío ⇒ 0 comerciales, sin CPL falso)', async () => {
    const v = await outcomesVivosDe(store(), ctxDe('org-smileflow'), 'org-smileflow');
    const lead = v.outcomes.find((o) => o.outcome === 'LEAD');
    expect(lead?.value).toBe(0); // conectado sin datos ≠ no disponible; 0 real
    expect(lead?.testExcluded).toBe(0);
    // ZERO_REAL_LEADS_DOES_NOT_MEAN_ZERO_COST_PER_LEAD: CPL no es $0.
    const cpl = v.economia.find((i) => i.nombre === 'CPL');
    expect(cpl?.valor).toBeNull();
    expect(['INSUFFICIENT_DATA', 'NO_CONVERSIONS']).toContain(cpl?.disponibilidad);
  });

  it('la estrategia es SHADOW y no recomienda automáticamente', () => {
    expect(estrategiaDe('org-cyp').naturaleza).toBe('SHADOW');
    expect(estrategiaDe('org-cyp').recomendacion).toBeNull();
  });
});
