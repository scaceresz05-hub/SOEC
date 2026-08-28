/**
 * MATERIALIZADOR Google-native V2: una sola GoogleAdsService.Mutate para todo el grafo, Google-native, temporary
 * resource names, partialFailure=false, geo (4 positivas + RM negativa, PRESENCE), Campaign Total Budget. Validate
 * y real comparten esta materialización (sólo cambia validateOnly). Sin referencias a la campaña histórica.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { GEO_SMILEFLOW_V2, type GeoRegionResuelta } from '../src/campana/geo-policy';
import { materializarGoogleAdsMutate, contarOperaciones, biddingGoogleDePlan, ventanaFechasDesdeActivacion } from '../src/campana/google-ads-materializer';

const T = '2026-08-27T00:00:00.000Z';
const CID = '8605539300';
const DISP: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: T, evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  // 'administracion clinica dental' está en la denylist de política Google → NO debe quedar como keyword activa;
  // 'agenda clinica dental' (gestión, no denegada) mantiene el ad group TARGET con al menos una keyword.
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'agenda clinica dental', impresiones: 220, clics: 10 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(entrada);
const GEO: GeoRegionResuelta[] = [
  { nombre: 'Tarapacá', negativa: false, criterionId: '20154', canonicalName: 'Tarapaca,Chile' },
  { nombre: 'Antofagasta', negativa: false, criterionId: '20155', canonicalName: 'Antofagasta,Chile' },
  { nombre: 'La Araucanía', negativa: false, criterionId: '20162', canonicalName: 'Araucania,Chile' },
  { nombre: 'Los Lagos', negativa: false, criterionId: '20164', canonicalName: 'Los Lagos,Chile' },
  { nombre: 'Región Metropolitana de Santiago', negativa: true, criterionId: '20161', canonicalName: 'Santiago Metropolitan,Chile' },
];
const VENTANA = ventanaFechasDesdeActivacion('2026-09-01');
const req = materializarGoogleAdsMutate(PLAN, GEO_SMILEFLOW_V2, GEO, { customerId: CID, ...VENTANA, validateOnly: true })!;
const opDe = (clave: string): Record<string, unknown> => (req.mutateOperations.find((o) => Object.keys(o)[0] === clave) as Record<string, { create: Record<string, unknown> }>)[clave]!.create;
const opDe2 = (o: { readonly [k: string]: unknown }): Record<string, unknown> => { const k = Object.keys(o)[0]!; return (o as Record<string, { create: Record<string, unknown> }>)[k]!.create; };
const budget = opDe('campaignBudgetOperation');
const campaign = opDe('campaignOperation');

describe('materializador Google-native V2', () => {
  it('J: partialFailure=false + validateOnly', () => {
    expect(req.partialFailure).toBe(false);
    expect(req.validateOnly).toBe(true);
  });
  it('A/B: Campaign Google-native (advertisingChannelType=SEARCH) sin campaignType/objective/budgetPolicy', () => {
    expect(campaign.advertisingChannelType).toBe('SEARCH');
    expect('campaignType' in campaign).toBe(false);
    expect('objective' in campaign).toBe(false);
    expect('budgetPolicy' in campaign).toBe(false);
  });
  it('bidding real (MAXIMIZE_CONVERSIONS derivada de LEADS) + networkSettings conservadores', () => {
    expect(biddingGoogleDePlan(PLAN).google).toBe('MAXIMIZE_CONVERSIONS');
    expect(campaign.maximizeConversions).toBeDefined();
    expect(campaign.networkSettings).toEqual({ targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false });
  });
  it('C: Campaign Total Budget CUSTOM_PERIOD 15000000000 explicitly_shared=false (sin amountMicros)', () => {
    expect(budget.period).toBe('CUSTOM_PERIOD');
    expect(budget.totalAmountMicros).toBe(15_000_000_000);
    expect(budget.explicitlyShared).toBe(false);
    expect('amountMicros' in budget).toBe(false);
  });
  it('A/B/C/D: startDateTime/endDateTime (v25) — NO startDate/endDate/start_date/end_date; formato + fin=inicio+9', () => {
    // A: los campos obsoletos (removidos en v23) NO existen — fue el "Unknown name" que rechazó Google.
    for (const k of ['startDate', 'endDate', 'start_date', 'end_date']) expect(k in campaign).toBe(false);
    // B/C: los vigentes existen con formato 'yyyy-MM-dd HH:mm:ss' (00:00:00 / 23:59:59).
    expect(campaign.startDateTime).toBe('2026-09-01 00:00:00');
    expect(campaign.endDateTime).toBe('2026-09-10 23:59:59');
    expect(JSON.stringify(req)).not.toMatch(/"(startDate|endDate|start_date|end_date)":/);
    // D: 10 días calendario inclusivos (inicio + 9). Verificado también en el borde de mes.
    expect(ventanaFechasDesdeActivacion('2026-09-01')).toEqual({ startDateTime: '2026-09-01 00:00:00', endDateTime: '2026-09-10 23:59:59' });
    expect(ventanaFechasDesdeActivacion('2026-08-27')).toEqual({ startDateTime: '2026-08-27 00:00:00', endDateTime: '2026-09-05 23:59:59' });
  });
  it('H: geoTargetTypeSetting PRESENCE/PRESENCE', () => {
    expect(campaign.geoTargetTypeSetting).toEqual({ positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' });
  });
  it('I: temporary resource references (hijos referencian el temp RN del padre en la MISMA request)', () => {
    expect(campaign.campaignBudget).toBe(budget.resourceName);
    const adGroups = req.mutateOperations.filter((o) => Object.keys(o)[0] === 'adGroupOperation').map((o) => (o as { adGroupOperation: { create: { resourceName: string; campaign: string } } }).adGroupOperation.create);
    expect(adGroups.every((ag) => ag.campaign === campaign.resourceName)).toBe(true);
    const ads = req.mutateOperations.filter((o) => Object.keys(o)[0] === 'adGroupAdOperation').map((o) => (o as { adGroupAdOperation: { create: { adGroup: string } } }).adGroupAdOperation.create);
    const agRNs = new Set(adGroups.map((ag) => ag.resourceName));
    expect(ads.every((ad) => agRNs.has(ad.adGroup))).toBe(true);
  });
  it('F/G: geo = 4 regiones positivas + RM negativa (negative=true); sin targetear Chile completo', () => {
    const criterios = req.mutateOperations.filter((o) => Object.keys(o)[0] === 'campaignCriterionOperation').map((o) => (o as { campaignCriterionOperation: { create: Record<string, unknown> } }).campaignCriterionOperation.create);
    const locations = criterios.filter((c) => 'location' in c);
    const positivas = locations.filter((c) => !('negative' in c) || c.negative !== true);
    const negativas = locations.filter((c) => c.negative === true);
    expect(positivas.length).toBe(4);
    expect(negativas.length).toBe(1);
    expect((negativas[0]!.location as { geoTargetConstant: string }).geoTargetConstant).toBe('geoTargetConstants/20161'); // RM
    expect(new Set(positivas.map((c) => (c.location as { geoTargetConstant: string }).geoTargetConstant))).toEqual(new Set(['geoTargetConstants/20154', 'geoTargetConstants/20155', 'geoTargetConstants/20162', 'geoTargetConstants/20164']));
  });
  it('M: HISTORICAL_RESOURCE_REFERENCES=0 (no aparece 24120966895)', () => {
    expect(JSON.stringify(req)).not.toContain('24120966895');
  });
  it('política: la keyword denegada por Google no aparece en el grafo materializado (retiro determinista)', () => {
    expect(JSON.stringify(req).toLowerCase()).not.toContain('administracion clinica dental');
    // pero la keyword de gestión no denegada sí sobrevive (el ad group TARGET no queda vacío)
    expect(JSON.stringify(req).toLowerCase()).toContain('agenda clinica dental');
  });
  it('K: validate y real comparten materializador (sólo cambia validateOnly)', () => {
    const real = materializarGoogleAdsMutate(PLAN, GEO_SMILEFLOW_V2, GEO, { customerId: CID, ...VENTANA, validateOnly: false })!;
    expect(real.validateOnly).toBeUndefined();
    expect(real.mutateOperations).toEqual(req.mutateOperations); // mismo grafo
  });
  it('A: Campaign declara containsEuPoliticalAdvertising = DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING', () => {
    expect(campaign.containsEuPoliticalAdvertising).toBe('DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
  });
  it('B/C/D: budget, campaign y 2 ad groups tienen temp resource name COMPLETO (customers/.../-N)', () => {
    expect(String(budget.resourceName)).toMatch(/^customers\/8605539300\/campaignBudgets\/-\d+$/);
    expect(String(campaign.resourceName)).toMatch(/^customers\/8605539300\/campaigns\/-\d+$/);
    const ags = req.mutateOperations.filter((o) => Object.keys(o)[0] === 'adGroupOperation').map((o) => opDe2(o).resourceName);
    expect(ags).toHaveLength(2);
    ags.forEach((rn) => expect(String(rn)).toMatch(/^customers\/8605539300\/adGroups\/-\d+$/));
  });
  it('E/F/G: adGroupAds, adGroupCriteria y campaignCriteria NO llevan resourceName propio (hojas)', () => {
    for (const t of ['adGroupAdOperation', 'adGroupCriterionOperation', 'campaignCriterionOperation']) {
      const creates = req.mutateOperations.filter((o) => Object.keys(o)[0] === t).map(opDe2);
      expect(creates.length).toBeGreaterThan(0);
      creates.forEach((c) => expect('resourceName' in c).toBe(false));
    }
  });
  it('K: NINGÚN resourceName bare /^-\\d+$/ en todo el payload (era el BAD_RESOURCE_ID)', () => {
    req.mutateOperations.map(opDe2).forEach((c) => { if ('resourceName' in c) expect(String(c.resourceName)).not.toMatch(/^-\d+$/); });
  });
  it('L: los temp resource names (sólo padres) son 4, únicos y negativos', () => {
    const temps = req.mutateOperations.map(opDe2).filter((c) => 'resourceName' in c).map((c) => String(c.resourceName));
    expect(temps).toHaveLength(4); // budget + campaign + 2 adGroups
    expect(new Set(temps).size).toBe(4);
    temps.forEach((t) => expect(t).toMatch(/\/-\d+$/));
  });
  it('H/I/J/M: refs padre válidas y DEFINIDAS antes de usarse (ads/criteria→adGroup, campaignCriteria→campaign)', () => {
    const creates = req.mutateOperations.map((o) => ({ type: Object.keys(o)[0]!, c: opDe2(o) }));
    const idxDe = (rn: string): number => creates.findIndex((x) => x.c.resourceName === rn);
    const agRNs = new Set(creates.filter((x) => x.type === 'adGroupOperation').map((x) => String(x.c.resourceName)));
    creates.forEach((x, i) => {
      if (x.type === 'adGroupAdOperation' || x.type === 'adGroupCriterionOperation') {
        expect(agRNs.has(String(x.c.adGroup))).toBe(true);           // referencia un ad group real
        expect(idxDe(String(x.c.adGroup))).toBeLessThan(i);          // definido ANTES
      }
      if (x.type === 'campaignCriterionOperation') {
        expect(String(x.c.campaign)).toBe(String(campaign.resourceName));
        expect(idxDe(String(x.c.campaign))).toBeLessThan(i);
      }
    });
  });
  it('conteo de operaciones (budget+campaign separados) + geo=5', () => {
    const c = contarOperaciones(req);
    expect(c.campaignBudgetOperation).toBe(1);
    expect(c.campaignOperation).toBe(1);
    expect(c.adGroupOperation).toBe(2);
    expect(c.adGroupAdOperation).toBe(2);
    expect(c.adGroupCriterionOperation).toBe(PLAN.activeKeywords.length);
    const geoCount = 5;
    expect(c.campaignCriterionOperation).toBe((PLAN.campaigns[0]!.negativeKeywords.length) + geoCount);
  });
});
