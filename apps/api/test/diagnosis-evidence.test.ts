/**
 * CONTRATO READINESS writer↔reader: valueProps y validatedDestinations se ACEPTAN, se PRESERVAN (no se
 * descartan en silencio) y ROUNDTRIP semántico. Campo soportado inválido ⇒ error explícito (400).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { normalizarReadinessInput, type MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { DiagnosisEvidenceService } from '../src/campana/diagnosis-evidence-service';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const AHORA = '2026-08-25T00:00:00.000Z';
const BODY_COMPLETO = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, evidenceSource: 'chrome-audit', findings: ['x'],
  valueProps: [
    { id: 'vp1', capability: 'Agenda inteligente', evidence: 'landing:features' },
    { id: 'vp2', capability: 'Recordatorios automáticos', evidence: 'landing:features' },
  ],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true, evidence: 'sitelinks' }],
  brandName: 'SmileFlow',
};

describe('normalizarReadinessInput', () => {
  it('diagnosis_evidence_accepts_value_props + diagnosis_evidence_accepts_validated_destinations', () => {
    const r = normalizarReadinessInput(BODY_COMPLETO, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readiness.valueProps?.length).toBe(2);
    expect(r.readiness.validatedDestinations?.length).toBe(1);
  });
  it('supported_fields_are_not_silently_dropped', () => {
    const r = normalizarReadinessInput(BODY_COMPLETO, AHORA);
    if (!r.ok) throw new Error('debía normalizar');
    expect(r.readiness.valueProps?.[0]!.capability).toBe('Agenda inteligente');
    expect(r.readiness.valueProps?.[0]!.evidence).toBe('landing:features');
    expect(r.readiness.validatedDestinations?.[0]!.url).toBe('https://x/#plans-trial');
    expect(r.readiness.brandName).toBe('SmileFlow');
  });
  it('acepta valueProps string legacy y las coacciona a {capability}', () => {
    const r = normalizarReadinessInput({ ...BODY_COMPLETO, valueProps: ['Prueba 15 días'] }, AHORA);
    if (!r.ok) throw new Error('debía normalizar');
    expect(r.readiness.valueProps?.[0]!.capability).toBe('Prueba 15 días');
  });
  it('campo soportado inválido ⇒ error explícito (400)', () => {
    expect(normalizarReadinessInput({ ...BODY_COMPLETO, valueProps: [{ evidence: 'x' }] }, AHORA).ok).toBe(false);
    expect(normalizarReadinessInput({ ...BODY_COMPLETO, validatedDestinations: [{ url: 'u', intent: 'plans', validated: 'yes', public: true, available: true }] }, AHORA).ok).toBe(false);
    expect(normalizarReadinessInput({ landing: { status: 'PASS' } }, AHORA).ok).toBe(false); // incompleta
  });
});

describe('roundtrip persistido (writer=reader)', () => {
  it('diagnosis_evidence_roundtrips_value_props + diagnosis_evidence_roundtrips_validated_destinations', async () => {
    const store = new InMemoryEventStore();
    const svc = new DiagnosisEvidenceService(store);
    const norm = normalizarReadinessInput(BODY_COMPLETO, AHORA);
    if (!norm.ok) throw new Error('normalize');
    await svc.registrar(ORG, norm.readiness, AHORA);
    const leido = await svc.leerUltima(ORG) as MarketingReadiness;
    expect(leido.valueProps).toEqual(norm.readiness.valueProps);
    expect(leido.validatedDestinations).toEqual(norm.readiness.validatedDestinations);
    expect(await svc.leerUltima('org-otra')).toBeNull(); // tenant-scoped
  });
});
