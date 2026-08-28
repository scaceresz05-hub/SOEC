/**
 * CIERRE FINAL — materializar NEW PLAN + NEW ENVELOPE desde el candidate saneado. Verifica: el plan definitivo
 * pierde las 4 keywords denegadas (no runtime sanitizer), el NEW hash != old, el NEW envelope nace
 * READY_FOR_HUMAN_APPROVAL (fail-closed, executionAllowed DENY), el OLD envelope queda SUPERSEDED, el OLD plan
 * no se muta, y el executor resuelve el NEW envelope→hash→plan (lock exacto) — denegando sólo por SUPERVISED_REAL.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { construirMarketingPlan, retirarKeywordsDenegadasDelPlan, type EntradaMarketingPlan, type CanalId, type MarketingPlan } from '../src/campana/marketing-plan';
import { hashPlan } from '../src/campana/plan-hash';
import { CampaignOperatorDryRunService } from '../src/campana/campaign-operator-service';
import { EnvelopeService } from '../src/campana/envelope-service';
import { aprobar, validateAuthorizedExecution, type ProviderState, type FlagsEjecucion } from '../src/campana/authorized-execution-envelope';
import { ledgerCero } from '../src/campana/financial-ledger';
import { ejecutarCanary } from '../src/campana/canary-execution';
import { GoogleAdsRealMutatePort, type GoogleAdsApiClient, type GoogleAdsOperation } from '../src/campana/google-ads-real-port';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const T = '2026-08-27T00:00:00.000Z';
const ORG = 'org-smileflow';
const CUSTOMER = '8605539300';
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
const DENEGADAS = ['ficha clinica odontologica', 'ficha clínica odontológica', 'administracion clinica dental', 'ficha clinica dental']
  .map((text) => ({ text, matchType: 'PHRASE' as const, action: 'TARGET' as const, intentClassification: 'CLINIC_MANAGEMENT_INTENT' as const, confidence: 'HIGH' as const, rationale: 'persisted pre-denylist' }));
// Plan PERSISTIDO viejo: base + las 4 denegadas (simula lo guardado antes del denylist).
const base = construirMarketingPlan(entrada);
const c0 = base.campaigns[0]!;
const planViejo: MarketingPlan = { ...base, activeKeywords: [...base.activeKeywords, ...DENEGADAS], campaigns: [{ ...c0, adGroups: [{ ...c0.adGroups[0]!, keywords: [...c0.adGroups[0]!.keywords, ...DENEGADAS] }, ...c0.adGroups.slice(1)] }] };

class FakeClient implements GoogleAdsApiClient { async aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }> { return { resourceName: `${op.resourceType}/1` }; } }

async function finalizar() {
  const store = new InMemoryEventStore();
  const operador = new CampaignOperatorDryRunService(store);
  const envelopes = new EnvelopeService(store);
  // Estado inicial: plan viejo persistido + envelope viejo (hash viejo).
  await operador.persistirPlanFinal(ORG, planViejo, `plan:${ORG}:${T}`, T);
  const envViejo = await envelopes.crearDesdePlan(ORG, planViejo, `plan:${ORG}:${T}`, T);
  // FINALIZE: sanear → persistir candidate → crear nuevo envelope (supersede viejo).
  const persistido = (await operador.leerUltimo(ORG))!.plan;
  const candidato = retirarKeywordsDenegadasDelPlan(persistido);
  const t1 = '2026-08-28T03:10:00.000Z';
  await operador.persistirPlanFinal(ORG, candidato, `plan:${ORG}:${t1}`, t1);
  const envNuevo = await envelopes.crearDesdePlan(ORG, candidato, `plan:${ORG}:${t1}`, t1);
  return { store, operador, envelopes, envViejo, envNuevo, candidato };
}

describe('candidate-finalize — NEW plan + NEW envelope', () => {
  it('el plan definitivo pierde las 4 denegadas (−4) y NO depende de saneador en runtime', async () => {
    const { operador } = await finalizar();
    const plan = (await operador.leerUltimo(ORG))!.plan;
    expect(plan.activeKeywords.length).toBe(base.activeKeywords.length); // = viejo(−4) = base
    for (const d of DENEGADAS) expect(plan.activeKeywords.some((k) => k.text === d.text)).toBe(false);
  });
  it('NEW hash != OLD hash; NEW envelope READY_FOR_HUMAN_APPROVAL; OLD superseded; executionAllowed DENY', async () => {
    const { envelopes, envViejo, envNuevo, candidato } = await finalizar();
    expect(envNuevo.planHash).toBe(hashPlan(candidato));
    expect(envNuevo.planHash).not.toBe(envViejo.planHash); // cambió el set de keywords
    expect(envNuevo.status).toBe('READY_FOR_HUMAN_APPROVAL');
    expect(envNuevo.id).toBe(`env:${ORG}:${envNuevo.planHash}`);
    // OLD superseded en el audit; leerUltimo devuelve el NUEVO (last-wins).
    const audit = await envelopes.auditoria(ORG);
    expect(audit.some((a) => a.type === 'ENVELOPE_SUPERSEDED' && a.oldPlanHash === envViejo.planHash && a.newPlanHash === envNuevo.planHash)).toBe(true);
    expect((await envelopes.leerUltimo(ORG))!.id).toBe(envNuevo.id);
    // executionAllowed = DENY (fail-closed): sin SUPERVISED_REAL, ni siquiera aprobado.
    const prov: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: T, contacts: 1 };
    const dec = validateAuthorizedExecution(envNuevo, candidato, prov, ledgerCero(30000, 15000, 0), { canal: 'google', tipo: 'CREATE_CAMPAIGN' }, { supervisedReal: false, autonomousReal: false });
    expect(dec.decision).toBe('DENY');
    expect(dec.reasonCode).toBe('SUPERVISED_REAL_DISABLED');
  });
  it('el OLD plan no se muta (retirar es puro): sigue con las 4 y su hash viejo', () => {
    expect(planViejo.activeKeywords.filter((k) => DENEGADAS.some((d) => d.text === k.text))).toHaveLength(4);
    expect(hashPlan(planViejo)).not.toBe(hashPlan(retirarKeywordsDenegadasDelPlan(planViejo)));
  });
  it('el executor resuelve el NEW envelope→hash→plan (contexto derivado) y sólo DENIEGA por SUPERVISED_REAL', async () => {
    const { envelopes, envNuevo, candidato } = await finalizar();
    const aprobado = aprobar(envNuevo, candidato, 'humano', T, ['google']).envelope; // aprobado SÓLO en el test
    const prov: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: T, contacts: 1 };
    const entradas = { org: ORG, customerId: CUSTOMER, envelope: aprobado, plan: candidato, ledger: ledgerCero(30000, 15000, 0), prov, flags: { supervisedReal: false, autonomousReal: false } as FlagsEjecucion, port: new GoogleAdsRealMutatePort(new FakeClient()), bindingsExistentes: [], ahora: T };
    // Contexto DERIVADO del envelope vigente (como en la ruta canary-execute) ⇒ resuelve el NEW plan.
    const derivado = { org: ORG, customerId: CUSTOMER, envelopeId: aprobado.id, planHash: aprobado.planHash };
    const r = await ejecutarCanary(entradas, derivado);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('SUPERVISED_REAL_DISABLED'); // pasó todos los locks de contexto; sólo el master switch lo detiene
    // Con el contexto viejo hardcodeado, el MISMO envelope nuevo sería rechazado por id ⇒ prueba por qué se derivó.
    const viejo = { org: ORG, customerId: CUSTOMER, envelopeId: 'env:org-smileflow:842a5165b22c462d', planHash: '842a5165b22c462d' };
    expect((await ejecutarCanary(entradas, viejo)).reason).toBe('ENVELOPE_ID_MISMATCH');
    void envelopes;
  });
});
