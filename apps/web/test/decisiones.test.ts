// @vitest-environment jsdom
/**
 * Bucle de decisión (UI). Con una decisión PENDING aparece "Necesita tu decisión" + Aprobar/Rechazar/Ajustar y el
 * NUEVO compromiso $0 (PREPARE no gasta); sin decisión vigente, "No necesitas decidir nada" (nunca ambas a la vez).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Decisiones } from '../components/decisiones';

const prepare = {
  decisionId: '24194332264:STOP_ZERO_CONVERSION::PREPARE_EXPERIMENT_2::v3-phase-segmented',
  recommendationId: 'r', experimentId: 'e', campaignId: '24194332264',
  decisionType: 'PREPARE_EXPERIMENT_2', decisionStatus: 'PENDING', createdAt: '2026-09-07T00:00:00Z', evidenceVersion: 'v3-phase-segmented', planHash: 'abc',
  requiresHumanApproval: true, confidence: 'LOW', financialCommitmentClp: 0, providerWritesExpected: 0,
  title: 'Preparar Experimento 2 (targeting más cualificado)', why: 'matching demasiado ambiguo.', plan: ['Concordancia EXACTA.'],
  historicalCampaignBudgetClp: 15000, historicalSpendClp: 7760, source: 'director', parentDecisionId: null, supersedes: null,
};
function stub(current: unknown, history: unknown[] = []): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, current, history }) })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Decisiones (SSOT)', () => {
  it('N/B: decisión PENDING ⇒ Aprobar/Rechazar/Ajustar + compromiso $0; NO "no necesitas decidir"', async () => {
    stub(prepare);
    render(h(Decisiones, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/Preparar Experimento 2/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajustar' })).toBeTruthy();
    expect(screen.getByText(/Nuevo compromiso financiero en esta decisión:/).textContent).toMatch(/\$0/);
    expect(screen.queryByText(/No necesitas decidir nada ahora/)).toBeNull();
  });
  it('sin decisión vigente ⇒ "No necesitas decidir nada"; sin botón Aprobar', async () => {
    stub(null);
    render(h(Decisiones, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/No necesitas decidir nada ahora/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
  });
});
