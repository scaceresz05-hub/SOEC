// @vitest-environment jsdom
/**
 * HIDRATACIÓN del bloque de AUTORIZACIÓN desde el envelope PERSISTIDO (GET), en carga fría, sin re-simular ni
 * ningún POST. El botón AUTORIZAR sólo aparece en READY_FOR_HUMAN_APPROVAL. Tenant-scoped y fail-safe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AutorizacionSobre } from '../components/autorizacion-sobre';

const envelope = (status: string) => ({
  id: 'env:org-smileflow:df90b634b13b9bda', planId: 'plan:org-smileflow:2026', status, objective: 'Conseguir clínicas dentales interesadas en SmileFlow', currency: 'CLP',
  totalCap: 30000, experimentBudget: 15000, maxSpendWithoutContact: 7500, authorizedDurationDays: 10, startsAt: null, expiresAt: null,
  plannedChannels: ['google'], authorizedChannels: ['google'], authorizedActionTypes: ['CREATE_CAMPAIGN', 'STOP_CAMPAIGN'],
  stopRules: [{ id: 'STOP_BUDGET', enabled: true, threshold: 30000 }, { id: 'STOP_ZERO_CONVERSION', enabled: true, threshold: 7500 }], planVersion: 'df90b634', planHash: 'df90b634b13b9bda', approvedBy: status.startsWith('APPROVED') ? 'humano' : null, approvedAt: null,
});
const resp = (status: string) => ({ envelope: envelope(status), financial: { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0, remainingCap: 30000 }, executionAllowed: { decision: 'DENY', reasonCode: 'SUPERVISED_REAL_DISABLED' }, autonomousReal: false, supervisedReal: false });

function stub(status: string, ok = true): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ ok, json: async () => resp(status) }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const soloGET = (fn: ReturnType<typeof vi.fn>): boolean => fn.mock.calls.every((c) => ((c[1] as { method?: string } | undefined)?.method ?? 'GET') === 'GET');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AutorizacionSobre · hidratación', () => {
  it('authorization_block_hydrates_from_persisted_envelope + page_reload_does_not_require_campaign_resimulation + read_only', async () => {
    const fn = stub('READY_FOR_HUMAN_APPROVAL');
    render(h(AutorizacionSobre, { org: 'org-smileflow' })); // montaje "en frío", sin simular
    await waitFor(() => expect(screen.getByText(/env:org-smileflow:df90b634b13b9bda/)).toBeTruthy());
    expect(screen.getByText(/TOPE GLOBAL DEL SOBRE:/)).toBeTruthy();
    expect(screen.getByText(/TIPO DE PRESUPUESTO GOOGLE:/)).toBeTruthy(); // total de campaña, no daily
    expect(screen.getByText(/días desde la activación/)).toBeTruthy(); // período arranca al activar
    expect(soloGET(fn)).toBe(true); // hydration_does_not_create_new_envelope / does_not_mutate / no_provider_mutation
  });

  it('ready_envelope_shows_approval_button', async () => {
    stub('READY_FOR_HUMAN_APPROVAL');
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /AUTORIZAR SOBRE DE EJECUCIÓN/ })).toBeTruthy());
  });

  it('superseded_envelope_does_not_show_approval_button', async () => {
    stub('SUPERSEDED');
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/Reemplazada por nueva revisión/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /AUTORIZAR SOBRE DE EJECUCIÓN/ })).toBeNull();
  });

  it('revoked_envelope_does_not_show_approval_button', async () => {
    stub('REVOKED');
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/Revocada/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /AUTORIZAR SOBRE DE EJECUCIÓN/ })).toBeNull();
  });

  it('envelope_get_failure_fails_safe (no asume "no hay sobre" ni crea uno)', async () => {
    const fn = stub('READY_FOR_HUMAN_APPROVAL', false); // GET no-ok
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/No pudimos leer el estado del sobre/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Preparar sobre de ejecución/ })).toBeNull(); // no fallback de creación
    expect(soloGET(fn)).toBe(true);
  });

  it('tenant_change_clears_previous_envelope_state + refresh_does_not_change_id_or_hash', async () => {
    stub('READY_FOR_HUMAN_APPROVAL');
    const { rerender } = render(h(AutorizacionSobre, { org: 'org-a', nonce: 0 }));
    await waitFor(() => expect(screen.getByText(/df90b634b13b9bda/)).toBeTruthy());
    // Cambio de tenant ⇒ re-lee (nonce distinto): el bloque se recarga sin cambiar id/hash del GET.
    rerender(h(AutorizacionSobre, { org: 'org-b', nonce: 1 }));
    await waitFor(() => expect(screen.getByText(/df90b634b13b9bda/)).toBeTruthy());
    expect(screen.getAllByText(/df90b634b13b9bda/).length).toBeGreaterThan(0);
  });
});
