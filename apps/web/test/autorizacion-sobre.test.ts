// @vitest-environment jsdom
/**
 * Bloque UI de AUTORIZACIÓN: usa el envelope PERSISTIDO (GET), distingue tope TOTAL del presupuesto del
 * experimento, el consentimiento contiene las tres cifras, y el botón AUTORIZAR sólo aparece cuando el
 * sobre está READY_FOR_HUMAN_APPROVAL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AutorizacionSobre } from '../components/autorizacion-sobre';

const envelope = (status: string) => ({
  id: 'env:org-smileflow:plan:1', planId: 'plan:org-smileflow:2026', status, objective: 'Conseguir clínicas dentales interesadas en SmileFlow', currency: 'CLP',
  totalCap: 30000, experimentBudget: 15000, maxSpendWithoutContact: 7500, startsAt: '2026-08-25T00:00:00Z', expiresAt: '2026-09-04T00:00:00Z',
  plannedChannels: ['google'], authorizedChannels: ['google'], authorizedActionTypes: ['CREATE_CAMPAIGN', 'STOP_CAMPAIGN'],
  stopRules: [{ id: 'STOP_BUDGET', enabled: true }, { id: 'STOP_ZERO_CONVERSION', enabled: true }], planVersion: 'ab12cd34', planHash: 'ab12cd34ef56', approvedBy: null, approvedAt: null,
});
const resp = (status: string) => ({ envelope: envelope(status), financial: { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0, remainingCap: 30000 }, executionAllowed: { decision: 'DENY', reasonCode: 'SUPERVISED_REAL_DISABLED' }, autonomousReal: false, supervisedReal: false });

function stubFetch(status: string): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => resp(status) })));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AutorizacionSobre', () => {
  it('authorization_ui_uses_persisted_envelope + distingue total cap de experiment budget', async () => {
    stubFetch('READY_FOR_HUMAN_APPROVAL');
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/env:org-smileflow/)).toBeTruthy());
    expect(screen.getByText(/TOPE TOTAL AUTORIZADO:/)).toBeTruthy();
    expect(screen.getByText(/PRESUPUESTO DEL PRIMER EXPERIMENTO:/)).toBeTruthy();
    // 30.000 ≠ 15.000 visibles y etiquetados por separado
    expect(screen.getAllByText(/\$30\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$15\.000/).length).toBeGreaterThan(0);
  });

  it('authorization_consent_contains_total_cap + experiment_budget + zero_contact_guardrail', async () => {
    stubFetch('READY_FOR_HUMAN_APPROVAL');
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    const consent = await waitFor(() => screen.getByText(/Autorizo a SOEC/));
    expect(consent.textContent).toContain('$30.000'); // tope total
    expect(consent.textContent).toContain('$15.000'); // primer experimento
    expect(consent.textContent).toContain('$7.500');  // corte sin contactos
  });

  it('approval_button_exists_only_when_ready', async () => {
    stubFetch('READY_FOR_HUMAN_APPROVAL');
    const { unmount } = render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /AUTORIZAR SOBRE DE EJECUCIÓN/ })).toBeTruthy());
    unmount(); cleanup(); vi.unstubAllGlobals();
    stubFetch('APPROVED_WAITING_EXTERNAL_GATE');
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/Autorizado por/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /AUTORIZAR SOBRE DE EJECUCIÓN/ })).toBeNull();
  });
});
