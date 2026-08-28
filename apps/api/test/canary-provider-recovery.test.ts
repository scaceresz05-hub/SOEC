/**
 * RECUPERACIÓN READ-ONLY de bindings desde Google Ads: correlación biyectiva plan↔recursos leídos, FAIL-CLOSED
 * (huella incorrecta / faltantes / ambigüedad ⇒ 0 persistencia, 0 IDs fabricados) e idempotente. Sin llamadas write.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import { correlacionarGrafo, consultasRecuperacion, type RecursosLeidos } from '../src/campana/canary-provider-recovery';
import { ResourceBindingService } from '../src/campana/resource-binding';
import { GEO_SMILEFLOW_V2, type GeoRegionResuelta } from '../src/campana/geo-policy';
import type { AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const T = '2026-08-28T15:00:00.000Z';
const ORG = 'org-smileflow';
const C = '8605539300';
const ENV = { id: 'env:org-smileflow:371c91ff00c6a837', organizationId: ORG, planHash: '371c91ff00c6a837' } as AuthorizedExecutionEnvelope;
const DISP: ChannelAvailability[] = [{ canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' }, { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' }];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: T, evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-06T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'agenda clinica dental', impresiones: 220, clics: 10 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(entrada);
const c0 = PLAN.campaigns[0]!;
const GEO: GeoRegionResuelta[] = GEO_SMILEFLOW_V2.regiones.map((g, i) => ({ nombre: g.nombre, negativa: g.negativa, criterionId: String(20100 + i), canonicalName: g.nombre }));
const EXPECTED = 2 + c0.adGroups.length + c0.adGroups.reduce((n, g) => n + g.ads.length, 0) + PLAN.activeKeywords.length + (c0.negativeKeywords ?? []).length + GEO.length;

// Construye los recursos LEIDOS (con resource names ficticios) que Google devolveria para ESTE plan.
function leidosDe(): RecursosLeidos {
  const rnGrupo = new Map<string, string>();
  c0.adGroups.forEach((g, i) => rnGrupo.set(g.action, `customers/${C}/adGroups/${200 + i}`));
  let n = 0;
    // Fila de campaign con el budget ATRIBUIDO (como devuelve GAQL: campaign + campaign_budget en la misma fila).
  const campRow = { campaign: { resourceName: `customers/${C}/campaigns/24194332264`, name: c0.campaignName, advertisingChannelType: 'SEARCH' }, campaignBudget: { resourceName: `customers/${C}/campaignBudgets/1`, totalAmountMicros: String(c0.budgetPolicy.totalAmount * 1_000_000) } };
  return {
    campaign: [campRow], campaignBudget: [campRow], // misma fila, ambos recursos (budget atribuido)
    adGroup: c0.adGroups.map((g) => ({ adGroup: { resourceName: rnGrupo.get(g.action)!, name: g.name } })),
    adGroupAd: c0.adGroups.flatMap((g) => g.ads.map((a) => ({ adGroupAd: { resourceName: `customers/${C}/adGroupAds/${300 + n++}`, ad: { responsiveSearchAd: { headlines: a.headlines.map((t) => ({ text: t })) } } }, adGroup: { resourceName: rnGrupo.get(g.action)! } }))),
    adGroupCriterion: PLAN.activeKeywords.map((k) => ({ adGroupCriterion: { resourceName: `customers/${C}/adGroupCriteria/${400 + n++}`, keyword: { text: k.text, matchType: k.matchType } }, adGroup: { resourceName: rnGrupo.get(k.action)! } })),
    campaignCriterion: [
      ...(c0.negativeKeywords ?? []).map((neg) => ({ campaignCriterion: { resourceName: `customers/${C}/campaignCriteria/${500 + n++}`, negative: true, keyword: { text: neg.text, matchType: neg.matchType } } })),
      ...GEO.map((g) => ({ campaignCriterion: { resourceName: `customers/${C}/campaignCriteria/${600 + n++}`, negative: g.negativa, location: { geoTargetConstant: `geoTargetConstants/${g.criterionId}` } } })),
    ],
  };
}

describe('recuperación read-only de bindings desde Google', () => {
  it('A/consistencia: match completo ⇒ ok, matched=expected, bindings de entidades accionables (no geo/budget)', () => {
    const r = correlacionarGrafo(ORG, ENV, PLAN, GEO, leidosDe(), T);
    expect(r.ok).toBe(true);
    expect(r.fingerprintOk).toBe(true);
    expect(r.matchedOperationCount).toBe(EXPECTED);
    expect(r.expectedOperations).toBe(EXPECTED);
    expect(r.unmatchedOperationCount).toBe(0);
    expect(r.ambiguousOperationCount).toBe(0);
    expect(r.campaignResourceName).toBe(`customers/${C}/campaigns/24194332264`);
    // bindings = campaign + adGroups + ads + keywords + negativas (geo y budget se correlacionan pero NO se bindean)
    const esperadosBind = 1 + c0.adGroups.length + c0.adGroups.reduce((n, g) => n + g.ads.length, 0) + PLAN.activeKeywords.length + (c0.negativeKeywords ?? []).length;
    expect(r.bindings.length).toBe(esperadosBind);
    expect(r.bindings.some((b) => b.entityType === 'campaign' && b.providerResourceId === `customers/${C}/campaigns/24194332264`)).toBe(true);
  });
  it('F: ningún resource name FABRICADO — cada binding usa un resourceName presente en lo leído', () => {
    const leidos = leidosDe();
    const nombresLeidos = new Set<string>();
    for (const arr of Object.values(leidos)) for (const row of arr as Array<Record<string, unknown>>) for (const v of Object.values(row)) { const rn = (v as { resourceName?: string })?.resourceName; if (rn) nombresLeidos.add(rn); }
    const r = correlacionarGrafo(ORG, ENV, PLAN, GEO, leidos, T);
    expect(r.bindings.every((b) => nombresLeidos.has(b.providerResourceId!))).toBe(true);
  });
  it('B: huella de campaña incorrecta ⇒ FAIL-CLOSED (0 bindings)', () => {
    const l = leidosDe();
    const bad = { ...l, campaign: [{ campaign: { ...l.campaign[0]!.campaign!, name: 'Otra campaña' } }] };
    const r = correlacionarGrafo(ORG, ENV, PLAN, GEO, bad, T);
    expect(r.ok).toBe(false); expect(r.reason).toBe('CAMPAIGN_FINGERPRINT_MISMATCH'); expect(r.bindings).toHaveLength(0);
    // budget incorrecto también falla la huella
    const badBudget = { ...l, campaignBudget: [{ campaignBudget: { resourceName: `customers/${C}/campaignBudgets/1`, totalAmountMicros: '999' } }] };
    expect(correlacionarGrafo(ORG, ENV, PLAN, GEO, badBudget, T).ok).toBe(false);
  });
  it('C: falta un recurso ⇒ FAIL-CLOSED (0 bindings, no parcial)', () => {
    const l = leidosDe();
    const r = correlacionarGrafo(ORG, ENV, PLAN, GEO, { ...l, adGroup: l.adGroup.slice(1) }, T);
    expect(r.ok).toBe(false); expect(r.reason).toBe('AD_GROUP_MISMATCH'); expect(r.bindings).toHaveLength(0);
  });
  it('D: matching ambiguo (recurso duplicado) ⇒ FAIL-CLOSED', () => {
    const l = leidosDe();
    const dupKw = { ...l, adGroupCriterion: [...l.adGroupCriterion, l.adGroupCriterion[0]!] }; // keyword duplicada
    const r = correlacionarGrafo(ORG, ENV, PLAN, GEO, dupKw, T);
    expect(r.ok).toBe(false); expect(r.bindings).toHaveLength(0);
  });
  it('E: persistencia idempotente — registrar los bindings dos veces no duplica', async () => {
    const svc = new ResourceBindingService(new InMemoryEventStore());
    const r = correlacionarGrafo(ORG, ENV, PLAN, GEO, leidosDe(), T);
    const persistir = async (): Promise<number> => { let reg = 0; for (const b of r.bindings) { if (!(await svc.buscar(ORG, ENV.id, b.materialFingerprint))) { await svc.registrar(b); reg++; } } return reg; };
    const p1 = await persistir(); const p2 = await persistir();
    expect(p1).toBe(r.bindings.length);
    expect(p2).toBe(0);
    expect((await svc.listar(ORG)).length).toBe(r.bindings.length);
  });
  it('G: consultas de LECTURA (SELECT…FROM), sin :mutate, y SIN el bug `FROM campaign_budget WHERE campaign.id`', () => {
    const q = consultasRecuperacion('24194332264');
    for (const gaql of Object.values(q)) { expect(gaql).toMatch(/^SELECT .+ FROM /); expect(gaql.toLowerCase()).not.toContain('mutate'); }
    // El budget se lee ATRIBUIDO desde campaign (no hay query separada `FROM campaign_budget`, que era INVALID_ARGUMENT).
    expect(Object.values(q).some((gaql) => /FROM campaign_budget/.test(gaql))).toBe(false);
    expect(q.campaign).toContain('campaign_budget.total_amount_micros');
    expect(q.campaign).toMatch(/FROM campaign\s+WHERE campaign\.id/);
  });
});
