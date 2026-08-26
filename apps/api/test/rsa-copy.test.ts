/**
 * QUALITY GATE de copy RSA: sin truncado mecánico. Headlines ≤30 y frases COMPLETAS, descriptions ≤90,
 * sin placeholders, respaldadas por valueProps verificadas; variante diferenciada en el grupo de competidor.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, esFraseCompleta, validarCopyAnuncio, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const TERMINOS = [
  { termino: 'administracion clinica dental', impresiones: 300, clics: 12 },
  { termino: 'dentalink precios', impresiones: 180, clics: 9 },
  { termino: 'exocad', impresiones: 50, clics: 1 },
];
const DISP: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
// 11 valueProps reales, varias LARGAS (antes se truncaban dejando frases colgantes).
const CAPS = [
  'Agenda dental inteligente y recordatorios automáticos',
  'Recordatorios automáticos de citas 24h antes',
  'Relleno automático de agenda',
  'Gestión de doctores, boxes y tratamientos',
  'Documentos clínicos y archivos por paciente',
  'Dashboard financiero en tiempo real',
  'Importación masiva de pacientes',
  'Ficha e historial clínico completo',
  'Prueba 15 días sin cotización',
  'Precio público transparente',
  'Producto local en español',
];
const READINESS: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, diagnosisCompletedAt: '2026-08-25T00:00:00.000Z', evidenceSource: 'chrome',
  findings: [], validatedDestinations: [
    { url: 'https://smileflowclinic.cl/#plans-trial', intent: 'plans', validated: true, public: true, available: true },
    { url: 'https://smileflowclinic.cl/#features-how', intent: 'features', validated: true, public: true, available: true },
  ], valueProps: CAPS.map((capability, i) => ({ id: `vp${i}`, capability })), brandName: 'SmileFlow',
};
const ENTRADA: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10,
  startAt: '2026-08-25T00:00:00.000Z', endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: TERMINOS },
  readiness: READINESS, historicalCpa: null,
};
const plan = construirMarketingPlan(ENTRADA);
const ads = plan.campaigns[0]!.adGroups.flatMap((g) => g.ads);
const heads = ads.flatMap((a) => a.headlines);
const descs = ads.flatMap((a) => a.descriptions);

describe('esFraseCompleta (unidad)', () => {
  it('rechaza colgantes/coma/incompletos', () => {
    for (const bad of ['Agenda dental inteligente y', 'Recordatorios automáticos de', 'Gestión y seguimiento de', 'Documentos clínicos y', 'Gestión de doctores,', 'SmileFlow']) expect(esFraseCompleta(bad)).toBe(false);
  });
  it('acepta frases completas', () => {
    for (const ok of ['Agenda dental inteligente', 'Recordatorios automáticos', 'Prueba 15 días sin cotización', 'Precio público transparente']) expect(esFraseCompleta(ok)).toBe(true);
  });
});

describe('copy RSA generado', () => {
  it('COPY_GRAMMATICALLY_COMPLETE: headlines ≤30 y completos', () => {
    const reales = heads.filter((h) => !/PENDING/i.test(h) && h !== 'SmileFlow');
    expect(reales.length).toBeGreaterThanOrEqual(3);
    for (const h of reales) { expect(h.length).toBeLessThanOrEqual(30); expect(esFraseCompleta(h), `colgante: "${h}"`).toBe(true); }
  });
  it('descriptions ≤90 y completas', () => {
    const reales = descs.filter((d) => !/PENDING/i.test(d));
    expect(reales.length).toBeGreaterThanOrEqual(2);
    for (const d of reales) { expect(d.length).toBeLessThanOrEqual(90); expect(esFraseCompleta(d)).toBe(true); }
  });
  it('PENDING_COPY_COUNT = 0 y sin colgantes reportados por el gate', () => {
    expect(plan.campaignCompleteness.pendingCopyCount).toBe(0);
    for (const a of ads) expect(validarCopyAnuncio(a, 'SmileFlow')).toEqual([]);
    expect(plan.campaignDraftStatus).toBe('READY_FOR_APPROVAL');
  });
  it('COPY_FACTUALLY_SUPPORTED: cada headline deriva de la marca, un CTA de evaluación o una valueProp', () => {
    const capsLow = CAPS.map((c) => c.toLowerCase());
    for (const h of heads.filter((x) => !/PENDING/i.test(x))) {
      const supported = h === 'SmileFlow' || /^(evalúa|compara)/i.test(h) || capsLow.some((c) => c.startsWith(h.toLowerCase()));
      expect(supported, `no respaldado: "${h}"`).toBe(true);
    }
  });
  it('grupo competidor usa variante diferenciada de evaluación (sin claims del competidor)', () => {
    const seg = plan.campaigns[0]!.adGroups.find((g) => g.action === 'SEGMENT')!;
    expect(seg.ads[0]!.headlines.some((h) => /^Evalúa SmileFlow$/.test(h) || /^Compara y prueba SmileFlow$/.test(h))).toBe(true);
    expect(seg.ads[0]!.headlines.some((h) => /dentalink/i.test(h))).toBe(false);
  });
  it('estados y guardrails intactos', () => {
    expect(plan.strategyStatus).toBe('READY');
    expect(plan.executionStatus).toBe('EXTERNAL_GATE_BLOCKED');
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'google')!.presupuesto).toBe(15000);
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'meta')!.presupuesto).toBe(0);
    expect(plan.maxSpendWithoutContact.value).toBe(7500);
  });
});

describe('quality gate bloquea copy incompleto', () => {
  it('valueProps sin frase corta completa ⇒ PENDING_COPY ⇒ INCOMPLETE', () => {
    const p = construirMarketingPlan({ ...ENTRADA, readiness: { ...READINESS, valueProps: [{ id: 'x', capability: 'supercalifragilisticoespialidosoextralargoirrecortable' }], brandName: 'SmileFlow' } });
    expect(p.campaignDraftStatus).toBe('INCOMPLETE');
    expect(p.campaignCompleteness.pendingCopyCount).toBeGreaterThan(0);
  });
});
