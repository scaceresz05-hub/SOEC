/**
 * DESALINEACIÓN prod: `canary-validate` materializa el plan PERSISTIDO (campaignOperator.leerUltimo), que fue
 * guardado ANTES del denylist y todavía contiene las 4 keywords denegadas por Google → 26 positivas / 65 ops.
 * El denylist sólo filtra al CONSTRUIR. Fix: `retirarKeywordsDenegadasDelPlan` sanea el plan persistido antes de
 * materializar (CANDIDATE V2 = 22 / 61) SIN mutar el plan persistido ni su hash. Este test reproduce ambos.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, retirarKeywordsDenegadasDelPlan, type EntradaMarketingPlan, type CanalId, type MarketingPlan } from '../src/campana/marketing-plan';
import { materializarGoogleAdsMutate, contarOperaciones, ventanaFechasDesdeActivacion } from '../src/campana/google-ads-materializer';
import { GEO_SMILEFLOW_V2, type GeoRegionResuelta } from '../src/campana/geo-policy';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const T = '2026-08-27T00:00:00.000Z';
const DISP: ChannelAvailability[] = [{ canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' }, { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' }];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: T, evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'agenda clinica dental', impresiones: 220, clics: 10 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }] },
  readiness: READY, historicalCpa: null,
};
const GEO: GeoRegionResuelta[] = GEO_SMILEFLOW_V2.regiones.map((r) => ({ nombre: r.nombre, negativa: r.negativa, criterionId: `id-${r.nombre}`, canonicalName: r.nombre }));
const V = ventanaFechasDesdeActivacion('2026-09-01');
const OPTS = { customerId: '8605539300', ...V, validateOnly: true as const };

// Simula el PLAN PERSISTIDO pre-denylist: inyecta las 4 keywords denegadas al plan (activeKeywords + ad group core).
const DENEGADAS = ['ficha clinica odontologica', 'ficha clínica odontológica', 'administracion clinica dental', 'ficha clinica dental']
  .map((text) => ({ text, matchType: 'PHRASE' as const, action: 'TARGET' as const, intentClassification: 'CLINIC_MANAGEMENT_INTENT' as const, confidence: 'HIGH' as const, rationale: 'persisted (pre-denylist)' }));
const base = construirMarketingPlan(entrada);
const c0 = base.campaigns[0]!;
const persistido: MarketingPlan = {
  ...base,
  activeKeywords: [...base.activeKeywords, ...DENEGADAS],
  campaigns: [{ ...c0, adGroups: [{ ...c0.adGroups[0]!, keywords: [...c0.adGroups[0]!.keywords, ...DENEGADAS] }, ...c0.adGroups.slice(1)] }],
};
const jsonDe = (p: MarketingPlan): string => JSON.stringify(materializarGoogleAdsMutate(p, GEO_SMILEFLOW_V2, GEO, OPTS)!).toLowerCase();

describe('alineación del candidate de producción (denylist en plan persistido)', () => {
  it('reproduce el bug: materializar el plan PERSISTIDO deja las 4 denegadas y N+4 keywords', () => {
    const req = materializarGoogleAdsMutate(persistido, GEO_SMILEFLOW_V2, GEO, OPTS)!;
    const positivas = contarOperaciones(req).adGroupCriterionOperation ?? 0;
    expect(positivas).toBe(base.activeKeywords.length + 4);
    expect(jsonDe(persistido)).toContain('administracion clinica dental'); // denegada presente (bug)
  });
  it('D/E: retirar NO muta el plan persistido ni su conteo (old plan intacto)', () => {
    const antes = persistido.activeKeywords.length;
    retirarKeywordsDenegadasDelPlan(persistido);
    expect(persistido.activeKeywords.length).toBe(antes); // el original no cambia (copia pura)
    expect(persistido.activeKeywords.filter((k) => DENEGADAS.some((d) => d.text === k.text))).toHaveLength(4);
  });
  it('A/B/C: el CANDIDATE saneado retira exactamente las 4, sin reemplazo, y baja el conteo en 4', () => {
    const candidato = retirarKeywordsDenegadasDelPlan(persistido);
    const reqC = materializarGoogleAdsMutate(candidato, GEO_SMILEFLOW_V2, GEO, OPTS)!;
    const reqP = materializarGoogleAdsMutate(persistido, GEO_SMILEFLOW_V2, GEO, OPTS)!;
    expect(candidato.activeKeywords.length).toBe(persistido.activeKeywords.length - 4);
    expect(contarOperaciones(reqC).total ?? 0).toBe((contarOperaciones(reqP).total ?? 0) - 4); // 4 keyword ops menos
    for (const d of DENEGADAS) expect(jsonDe(candidato)).not.toContain(d.text.toLowerCase());
  });
  it('G/H: negativas y geo del candidate intactas (28 y 5 en prod; aquí = plan base)', () => {
    const candidato = retirarKeywordsDenegadasDelPlan(persistido);
    const reqC = materializarGoogleAdsMutate(candidato, GEO_SMILEFLOW_V2, GEO, OPTS)!;
    const criterios = reqC.mutateOperations.filter((o) => Object.keys(o)[0] === 'campaignCriterionOperation').map((o) => (o as { campaignCriterionOperation: { create: Record<string, unknown> } }).campaignCriterionOperation.create);
    expect(criterios.filter((c) => 'location' in c)).toHaveLength(5); // geo intacta
    expect(criterios.filter((c) => 'keyword' in c).length).toBe((c0.negativeKeywords ?? []).length); // negativas intactas
  });
});
