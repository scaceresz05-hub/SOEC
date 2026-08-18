/**
 * MODELO DE CONOCIMIENTO del Director — epistemología (FACT/SIGNAL/HYPOTHESIS/RECOMMENDATION), comparación
 * temporal, no-data, stale, degraded/reauth, previous-zero, histórico insuficiente, sin causalidad, sin
 * ROI inventado, confianza, trazabilidad de evidencia, sin secretos/raw.
 */
import { describe, expect, it } from 'vitest';
import { construirConocimiento, compararMetrica } from '../src/acquisition/meta-knowledge';
import type { VistaDirectorMeta, ConocimientoCapacidad } from '../src/acquisition/meta-director';
import type { SnapshotSync, CapacidadSync, Freshness, ResumenNormalizado } from '../src/acquisition/meta-sync';

const IG = '17841432883225770';
const AD = '1037025024374407';
const T0 = '2026-08-18T02:00:00.000Z';

function capd(capability: CapacidadSync, externalId: string, resumen: ResumenNormalizado, freshness: Freshness = 'FRESH', capturedAt: string | null = T0): ConocimientoCapacidad {
  return { capability, externalId, source: 'meta', capturedAt, freshness, resumen };
}

function vistaCompleta(health = 'HEALTHY'): VistaDirectorMeta {
  return {
    organizationId: 'smileflow',
    connectionId: 'meta-smileflow',
    lastSuccessfulSyncAt: T0,
    health,
    capacidades: [
      capd('BUSINESS_IDENTITY', '934186066270538', { kind: 'BUSINESS_IDENTITY', count: 1 }),
      capd('PAGE_IDENTITY', '1066708446525633', { kind: 'PAGE_IDENTITY', count: 1 }),
      capd('INSTAGRAM_IDENTITY', IG, { kind: 'INSTAGRAM_IDENTITY', identity: { id: IG, username: 'smileflow.clinic' } }),
      capd('INSTAGRAM_MEDIA', IG, { kind: 'INSTAGRAM_MEDIA', count: 11 }),
      capd('INSTAGRAM_INSIGHTS', IG, { kind: 'INSTAGRAM_INSIGHTS', metrics: { reach: 321 } }),
      capd('ADS_ACCOUNT', AD, { kind: 'ADS_ACCOUNT', identity: { id: `act_${AD}`, currency: 'CLP', account_id: AD, account_status: '1' } }),
      capd('ADS_CAMPAIGNS', AD, { kind: 'ADS_CAMPAIGNS', count: 3 }),
      capd('ADS_INSIGHTS', AD, { kind: 'ADS_INSIGHTS', metrics: {} }), // no-data real de SmileFlow
    ],
  };
}

const hist = (capability: CapacidadSync, externalId: string, observedAt: string, resumen: ResumenNormalizado): SnapshotSync => ({ organizationId: 'smileflow', connectionId: 'meta-smileflow', capability, externalId, period: 'CURRENT', observedAt, source: 'meta', resumen });

describe('conocimiento · epistemología + no-data', () => {
  it('produce FACT/SIGNAL/RECOMMENDATION con evidencia; sin ROI inventado; no-data explícito', () => {
    const k = construirConocimiento(vistaCompleta(), [], T0);
    expect(k.facts.length).toBeGreaterThan(0);
    // Todos los items tienen type correcto y evidencia trazable.
    const todos = [...k.facts, ...k.metrics, ...k.signals, ...k.hypotheses, ...k.recommendations];
    for (const it of todos) {
      expect(['FACT', 'DERIVED_METRIC', 'SIGNAL', 'HYPOTHESIS', 'RECOMMENDATION']).toContain(it.type);
      expect(it.evidence.length).toBeGreaterThan(0);
    }
    // Ads insights vacío ⇒ SIGNAL no-data (no FACT, no métrica inventada).
    expect(k.signals.some((s) => s.id === 'signal:ads:insights:nodata')).toBe(true);
    // Frontera de capacidad: sin ROI.
    expect(k.facts.some((f) => f.id === 'info:no-roi')).toBe(true);
    // NUNCA un item de tipo FACT afirma causa (sin "porque"/"debido a" en facts).
    for (const f of k.facts) expect(/porque|debido a|causa/i.test(f.summary)).toBe(false);
  });

  it('IG con 11 media y 3 campañas: FACTs reflejan lo real (sin benchmarks)', () => {
    const k = construirConocimiento(vistaCompleta(), [], T0);
    expect(k.facts.some((f) => f.title.includes('11 publicaciones'))).toBe(true);
    expect(k.facts.some((f) => f.title.includes('3 campañas'))).toBe(true);
    // Sin juicio absoluto "bueno/malo".
    const s = JSON.stringify(k).toLowerCase();
    expect(s.includes('buen rendimiento')).toBe(false);
    expect(s.includes('excelente')).toBe(false);
  });
});

describe('conocimiento · salud', () => {
  it('REAUTH_REQUIRED ⇒ SIGNAL + RECOMMENDATION CRITICAL; overview urgente', () => {
    const k = construirConocimiento(vistaCompleta('REAUTH_REQUIRED'), [], T0);
    expect(k.signals.some((x) => x.priority === 'CRITICAL')).toBe(true);
    expect(k.recommendations.some((x) => x.priority === 'CRITICAL')).toBe(true);
    expect(k.priorities[0]!.priority).toBe('CRITICAL');
    expect(k.overview.toLowerCase()).toContain('reautoriz');
  });
  it('DEGRADED ⇒ SIGNAL HIGH', () => {
    const k = construirConocimiento(vistaCompleta('DEGRADED'), [], T0);
    expect(k.signals.some((x) => x.id === 'signal:health:degraded' && x.priority === 'HIGH')).toBe(true);
  });
});

describe('conocimiento · comparación temporal', () => {
  it('compararMetrica: previo=0 ⇒ deltaPct null (no dividir por cero); UP/DOWN/STABLE/UNKNOWN', () => {
    expect(compararMetrica(5, null)).toEqual({ direction: 'UNKNOWN', delta: 0, deltaPct: null });
    expect(compararMetrica(5, 0)).toEqual({ direction: 'UP', delta: 5, deltaPct: null });
    expect(compararMetrica(8, 4)).toEqual({ direction: 'UP', delta: 4, deltaPct: 100 });
    expect(compararMetrica(3, 6)).toEqual({ direction: 'DOWN', delta: -3, deltaPct: -50 });
    expect(compararMetrica(4, 4)).toEqual({ direction: 'STABLE', delta: 0, deltaPct: 0 });
  });

  it('histórico insuficiente ⇒ SIN item de tendencia (no inventa)', () => {
    const k = construirConocimiento(vistaCompleta(), [], T0);
    expect(k.metrics.some((m) => m.id === 'metric:ig:media:delta')).toBe(false);
  });

  it('con histórico ⇒ DERIVED_METRIC con dirección; caída de reach ⇒ HYPOTHESIS (no FACT, no causa)', () => {
    const historial: SnapshotSync[] = [
      hist('INSTAGRAM_MEDIA', IG, '2026-08-17T02:00:00.000Z', { kind: 'INSTAGRAM_MEDIA', count: 8 }),
      hist('INSTAGRAM_INSIGHTS', IG, '2026-08-17T02:00:00.000Z', { kind: 'INSTAGRAM_INSIGHTS', metrics: { reach: 500 } }),
    ];
    const k = construirConocimiento(vistaCompleta(), historial, T0);
    const delta = k.metrics.find((m) => m.id === 'metric:ig:media:delta')!;
    expect(delta.direction).toBe('UP'); // 11 vs 8
    expect(delta.delta).toBe(3);
    const hyp = k.hypotheses.find((h) => h.id === 'hyp:ig:reach:down');
    expect(hyp).toBeTruthy(); // 321 vs 500 ⇒ baja
    expect(hyp!.type).toBe('HYPOTHESIS');
    expect(/podría|posible/i.test(hyp!.summary)).toBe(true); // lenguaje hipotético, no causal
  });
});

describe('conocimiento · freshness + seguridad', () => {
  it('capacidades STALE ⇒ SIGNAL de frescura; confianza de FACT stale = MEDIUM', () => {
    const v = vistaCompleta();
    const conStale: VistaDirectorMeta = { ...v, capacidades: v.capacidades.map((c) => (c.capability === 'INSTAGRAM_MEDIA' ? { ...c, freshness: 'STALE' as Freshness } : c)) };
    const k = construirConocimiento(conStale, [], T0);
    expect(k.signals.some((s) => s.id === 'signal:freshness:stale')).toBe(true);
    expect(k.facts.find((f) => f.id === 'fact:ig:media')!.confidence).toBe('MEDIUM');
  });

  it('nunca expone secretos ni raw Graph', () => {
    const k = construirConocimiento(vistaCompleta(), [], T0);
    const s = JSON.stringify(k).toLowerCase();
    for (const p of ['access_token', 'secretref', 'ciphertext', 'graph.facebook.com', 'file:', 'paging', 'eaab']) {
      expect(s.includes(p)).toBe(false);
    }
  });

  it('tenant scoping: el conocimiento lleva el organizationId de la vista', () => {
    const k = construirConocimiento(vistaCompleta(), [], T0);
    expect(k.organizationId).toBe('smileflow');
  });
});
