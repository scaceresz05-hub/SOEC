/**
 * Bucle de decisión (SSOT compartido con "Mi director"). El servicio NO tiene cliente de Google: por construcción,
 * aprobar/rechazar/ajustar producen 0 escrituras a Google (sólo append al event store). Semántica PREPARE→LAUNCH:
 * aprobar PREPARE no gasta y genera una decisión LAUNCH (PENDING) que exige una SEGUNDA aprobación humana.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { analizarExperimento, type EvidenciaExperimento } from '../src/autonomia-ads/director-postmortem';
import { DecisionService, derivarDecisionBase } from '../src/autonomia-ads/decision-service';
import type { DirectorResultado } from '../src/autonomia-ads/director-cycle';

const evBase = (over: Partial<EvidenciaExperimento> = {}): EvidenciaExperimento => ({
  campaignId: '24194332264', status: 'PAUSED', periodoTerminado: false,
  spend: 3001, campaignTotalSpendClp: 7760, experimentBudgetClp: 15000, impressions: 160, clicks: 4, contacts: 0, conversions: 0,
  avgCpcClp: 750, ctr: 2.5,
  keywords: [{ keyword: 'software de administración dental', matchType: 'BROAD', impresiones: 100, clics: 2, gasto: 2414, conversions: 0 }],
  terminos: [{ termino: 'dentidesk inicio de sesión', impresiones: 60, clics: 1, gasto: 714 }],
  devices: [], geos: [], networks: [],
  trackingValid: true, landingValid: true, zeroContactStopClp: 7500,
  stopTriggered: true, stopRule: 'STOP_ZERO_CONVERSION',
  cpcInicialClp: 4759, cpcPosteriorClp: 750,
  phases: [], phaseSegmentation: 'SEGMENTED', analyzedPhaseLabel: 'PHASE_2', ...over,
});
function resultadoDe(over: Partial<EvidenciaExperimento> = {}, evidenceVersion = 'v3-phase-segmented'): DirectorResultado {
  const ev = evBase(over);
  return { experimentId: `24194332264:${ev.stopRule ?? 'running'}`, campaignId: '24194332264', campaignName: 'SmileFlow', status: ev.status, createdAt: '2026-09-07T00:00:00Z', analisis: analizarExperimento(ev), ranBy: 'scheduler', evidenceVersion, supersedes: null };
}
const svcDe = (res: DirectorResultado | null): DecisionService => new DecisionService(new InMemoryEventStore(), { leerResultado: async () => res, ahora: () => new Date().toISOString() });

describe('DecisionService — bucle de decisión, 0 escrituras Google', () => {
  it('A: Inicio y Decisiones ven el MISMO decisionId (derivación pura sobre el resultado del Director)', async () => {
    const res = resultadoDe();
    const est = await svcDe(res).estado('o');
    expect(est.current!.decisionId).toBe(derivarDecisionBase(res)!.decisionId);
  });
  it('B/I/J: PREPARE PENDING con Aprobar/Rechazar/Ajustar; compromiso 0; 0 escrituras; histórico separado', async () => {
    const est = await svcDe(resultadoDe()).estado('o');
    const d = est.current!;
    expect(d.decisionType).toBe('PREPARE_EXPERIMENT_2');
    expect(d.decisionStatus).toBe('PENDING');
    expect(d.requiresHumanApproval).toBe(true);
    expect(d.financialCommitmentClp).toBe(0);          // J
    expect(d.providerWritesExpected).toBe(0);          // C
    expect(d.historicalCampaignBudgetClp).toBe(15000); // I: 15000 es histórico, NO compromiso nuevo
    expect(d.historicalSpendClp).toBe(7760);
  });
  it('C/D/E: aprobar PREPARE no gasta y genera LAUNCH_EXPERIMENT_2 PENDING que exige 2ª aprobación', async () => {
    const svc = svcDe(resultadoDe());
    const base = (await svc.estado('o')).current!;
    const r = await svc.aprobar('o', base.decisionId, base.planHash, 'owner');
    expect(r.ok).toBe(true);
    expect(r.generated!.decisionType).toBe('LAUNCH_EXPERIMENT_2');   // D
    expect(r.generated!.decisionStatus).toBe('PENDING');
    expect(r.generated!.requiresHumanApproval).toBe(true);           // E
    expect(r.generated!.financialCommitmentClp).toBeGreaterThan(0);  // el compromiso real vive en LAUNCH
    expect(r.generated!.providerWritesExpected).toBeGreaterThan(0);
    const est = await svc.estado('o');
    expect(est.current!.decisionType).toBe('LAUNCH_EXPERIMENT_2');   // vigente ahora es LAUNCH
    expect(est.current!.decisionId).toBe(r.generated!.decisionId);
  });
  it('H: aprobación one-shot — reaprobar la MISMA decisión falla', async () => {
    const svc = svcDe(resultadoDe());
    const base = (await svc.estado('o')).current!;
    expect((await svc.aprobar('o', base.decisionId, base.planHash, 'owner')).ok).toBe(true);
    const r2 = await svc.aprobar('o', base.decisionId, base.planHash, 'owner');
    expect(r2.ok).toBe(false);
    expect(r2.motivo).toBe('YA_RESUELTA');
  });
  it('hash desactualizado ⇒ rechazo (no se aprueba a ciegas)', async () => {
    const svc = svcDe(resultadoDe());
    const base = (await svc.estado('o')).current!;
    const r = await svc.aprobar('o', base.decisionId, 'hash-viejo', 'owner');
    expect(r.ok).toBe(false); expect(r.motivo).toBe('HASH_DESACTUALIZADO');
  });
  it('F: rechazar persiste y NO se vuelve a ofrecer con la misma evidencia', async () => {
    const svc = svcDe(resultadoDe());
    const base = (await svc.estado('o')).current!;
    expect((await svc.rechazar('o', base.decisionId, 'owner', 'no ahora')).ok).toBe(true);
    const est = await svc.estado('o');
    expect(est.current).toBeNull();                                  // no re-ofrece
    expect((await svc.estado('o')).current).toBeNull();
  });
  it('G: ajustar SUPERSEDE la propuesta y genera otra PENDING con nuevo hash (sin gastar)', async () => {
    const svc = svcDe(resultadoDe());
    const base = (await svc.estado('o')).current!;
    const r = await svc.ajustar('o', base.decisionId, { budget: 9000, maxCpc: 700 }, 'owner', 'bajar presupuesto');
    expect(r.ok).toBe(true);
    expect(r.generated!.supersedes).toBe(base.decisionId);
    expect(r.generated!.planHash).not.toBe(base.planHash);
    expect(r.generated!.decisionStatus).toBe('PENDING');
    expect(r.generated!.requiresHumanApproval).toBe(true);          // sigue exigiendo aprobación
    const est = await svc.estado('o');
    expect(est.current!.decisionId).toBe(r.generated!.decisionId);  // la nueva es la vigente
    expect(est.current!.financialCommitmentClp).toBe(9000);         // toma el ajuste, pero PENDING (no gasta solo)
  });
  it('P: el historial contiene la decisión real (recomendada + acción)', async () => {
    const svc = svcDe(resultadoDe());
    const base = (await svc.estado('o')).current!;
    await svc.rechazar('o', base.decisionId, 'owner');
    const est = await svc.estado('o');
    expect(est.history.length).toBeGreaterThan(0);
    expect(est.history.some((h) => h.decisionId === base.decisionId && h.tipo === 'REJECTED')).toBe(true);
  });
  it('sin decisión humana (acción reductora de riesgo ⇒ COLLECT_MORE_DATA) ⇒ current null', async () => {
    const est = await svcDe(resultadoDe({ spend: null, clicks: null, impressions: null, contacts: null, keywords: [], terminos: [], stopTriggered: false, stopRule: null })).estado('o');
    expect(est.current).toBeNull();
  });
  it('sin resultado del Director ⇒ estado vacío, no rompe', async () => {
    const est = await svcDe(null).estado('o');
    expect(est.current).toBeNull();
    expect(est.history).toHaveLength(0);
  });
});
