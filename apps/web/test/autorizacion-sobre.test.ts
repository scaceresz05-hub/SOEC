// @vitest-environment jsdom
/**
 * HIDRATACIÓN del bloque de AUTORIZACIÓN desde el envelope PERSISTIDO (GET), en carga fría, sin re-simular ni
 * ningún POST. El botón AUTORIZAR sólo aparece en READY_FOR_HUMAN_APPROVAL. Tenant-scoped y fail-safe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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

  it('legacy_ui_cannot_authorize_current_policy (envelope incompatible ⇒ fail-closed, sin botón)', async () => {
    // Envelope del schema anterior: status READY pero SIN authorizedDurationDays; execution-plan lo marca incompatible.
    const legacy = { ...envelope('READY_FOR_HUMAN_APPROVAL') } as Record<string, unknown>;
    delete legacy.authorizedDurationDays;
    const fn = vi.fn(async (url: string) => {
      if (String(url).includes('/execution-plan')) return { ok: true, json: async () => ({ shadowPlanCreated: false, mode: 'SHADOW', summary: null, realExecutionDecision: 'DENY', realExecutionReason: 'ENVELOPE_MATERIAL_REFRESH_REQUIRED', providerMutateCalls: 0, envelopeCompatibility: { compatible: false, reasonCode: 'ENVELOPE_MATERIAL_REFRESH_REQUIRED' }, intents: [] }) };
      return { ok: true, json: async () => ({ envelope: legacy, financial: { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0, remainingCap: 30000 }, executionAllowed: { decision: 'DENY', reasonCode: 'ENVELOPE_NOT_APPROVED' }, autonomousReal: false, supervisedReal: false }) };
    });
    vi.stubGlobal('fetch', fn);
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await waitFor(() => expect(screen.getByText(/requiere actualización antes de poder autorizarse/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /AUTORIZAR SOBRE DE EJECUCIÓN/ })).toBeNull(); // AUTHORIZATION_BUTTON_ENABLED=false
    expect(screen.queryByText(/TIPO DE PRESUPUESTO GOOGLE:/)).toBeNull();       // no presenta CAMPAIGN_TOTAL
    expect(screen.queryByText(/días desde la activación/)).toBeNull();          // no presenta la duración nueva
    expect(soloGET(fn)).toBe(true);                                            // read-only, no muta
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

// ── Trigger HUMANO de ejecución del plan autorizado (§9 A–I) ──────────────────────────────────────────────
const envAprobado = () => envelope('APPROVED_WAITING_EXTERNAL_GATE');
function stubEjec(supervisedReal: boolean, canary: { status?: number; body?: unknown } = {}, exec?: { decision: string; reasonCode: string | null }): ReturnType<typeof vi.fn> {
  // El read model autoritativo: por defecto ALLOW si supervisado, DENY (supervised off) si no. Se puede sobreescribir.
  const executionAllowed = exec ?? (supervisedReal ? { decision: 'ALLOW', reasonCode: null } : { decision: 'DENY', reasonCode: 'SUPERVISED_REAL_DISABLED' });
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/canary-execute')) return { ok: (canary.status ?? 200) < 400, status: canary.status ?? 200, json: async () => canary.body ?? { decision: 'DENY', reason: 'SUPERVISED_REAL_DISABLED', providerMutateCalls: 0 } };
    if (u.includes('/execution-plan')) return { ok: true, json: async () => ({ shadowPlanCreated: true, summary: { executionActionCount: 59, byType: {}, entitiesAffected: 59 }, providerMutateCalls: 0 }) };
    return { ok: true, json: async () => ({ envelope: envAprobado(), financial: { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0, remainingCap: 30000 }, executionAllowed, autonomousReal: false, supervisedReal }) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const canaryPosts = (fn: ReturnType<typeof vi.fn>): number => fn.mock.calls.filter((c) => String(c[0]).includes('/canary-execute')).length;
const confirmarYEjecutar = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ }));
  fireEvent.click(await screen.findByRole('button', { name: /EJECUTAR AHORA/ }));
};

describe('AutorizacionSobre · ejecución humana del plan', () => {
  it('A: supervisedReal=false ⇒ botón EJECUTAR deshabilitado + MODO SUPERVISADO DESACTIVADO', async () => {
    stubEjec(false);
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    const btn = await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/MODO SUPERVISADO DESACTIVADO/)).toBeTruthy();
  });

  it('H: supervised true PERO executionAllowed=DENY (gate externo) ⇒ botón DESHABILITADO (sigue el backend)', async () => {
    stubEjec(true, {}, { decision: 'DENY', reasonCode: 'EXTERNAL_GATE_BLOCKED' });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    const btn = await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/EJECUCIÓN BLOQUEADA/)).toBeTruthy();
    expect(screen.getAllByText(/EXTERNAL_GATE_BLOCKED/).length).toBeGreaterThan(0);
  });

  it('I: executionAllowed=ALLOW ⇒ botón HABILITADO', async () => {
    stubEjec(true, {}, { decision: 'ALLOW', reasonCode: null });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    const btn = await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('E+H: supervised true ⇒ confirmar y EJECUTAR AHORA emite exactamente 1 POST al endpoint existente', async () => {
    const fn = stubEjec(true, { body: { decision: 'EXECUTED', providerMutateCalls: 59 } });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    const btn = await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await confirmarYEjecutar();
    await waitFor(() => expect(canaryPosts(fn)).toBe(1));
    const call = fn.mock.calls.find((c) => String(c[0]).includes('/canary-execute'))!;
    expect(String(call[0])).toContain('/api/medicion/canary-execute'); // H: usa el endpoint existente
    expect((call[1] as { method?: string }).method).toBe('POST');
  });

  it('D: CANCELAR ⇒ 0 POST de ejecución', async () => {
    const fn = stubEjec(true);
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    fireEvent.click(await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ }));
    fireEvent.click(await screen.findByRole('button', { name: /CANCELAR/ }));
    await new Promise((r) => setTimeout(r, 10));
    expect(canaryPosts(fn)).toBe(0);
  });

  it('F: doble click en EJECUTAR AHORA ⇒ exactamente 1 POST', async () => {
    const fn = stubEjec(true, { body: { decision: 'EXECUTED', providerMutateCalls: 59 } });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    fireEvent.click(await screen.findByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ }));
    const ahora = await screen.findByRole('button', { name: /EJECUTAR AHORA/ });
    fireEvent.click(ahora);
    fireEvent.click(ahora); // segundo click en el mismo tick
    await waitFor(() => expect(canaryPosts(fn)).toBe(1));
  });

  it('éxito REAL ⇒ mensaje "realizada · N recurso(s)" (sólo con providerActionsSucceeded>0)', async () => {
    stubEjec(true, { body: { decision: 'EXECUTED', outcome: 'EXECUTED', providerActionsSucceeded: 59 } });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await confirmarYEjecutar();
    await waitFor(() => expect(screen.getByText(/Ejecución realizada · 59 recurso/)).toBeTruthy());
  });

  it('EXECUTED con 0 éxitos ⇒ NO se presenta como éxito (el bug "acciones al proveedor: 1")', async () => {
    stubEjec(true, { body: { decision: 'EXECUTED', outcome: 'NO_ACTION_COMPLETED', providerActionsSucceeded: 0, intentsFailed: 1 } });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await confirmarYEjecutar();
    await waitFor(() => expect(screen.getByText(/NINGUNA acción se completó/)).toBeTruthy());
    expect(screen.queryByText(/Ejecución realizada/)).toBeNull(); // NO es un falso éxito
  });

  it('G: 5xx ⇒ resultado ambiguo, sin reintento ni re-habilitación', async () => {
    const fn = stubEjec(true, { status: 500 });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await confirmarYEjecutar();
    await waitFor(() => expect(screen.getByText(/Resultado ambiguo\. NO REINTENTAR/)).toBeTruthy());
    expect(canaryPosts(fn)).toBe(1);
    expect(screen.queryByRole('button', { name: /EJECUTAR PLAN AUTORIZADO/ })).toBeNull(); // no se re-habilita
  });

  it('B+C+I: sólo dispara canary-execute (no toca supervisedReal/envelope/plan) y no hay contexto editable', async () => {
    const fn = stubEjec(true, { body: { decision: 'EXECUTED', providerMutateCalls: 59 } });
    render(h(AutorizacionSobre, { org: 'org-smileflow' }));
    await confirmarYEjecutar();
    await waitFor(() => expect(canaryPosts(fn)).toBe(1));
    const posts = fn.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST').map((c) => String(c[0]));
    expect(posts.every((u) => u.includes('/canary-execute'))).toBe(true); // único POST mutador
    expect(posts.some((u) => /supervised|approve|revoke|envelope-/.test(u))).toBe(false); // no toggle supervised, no aprobar/revocar
    expect(document.querySelectorAll('input[type="text"], textarea').length).toBe(0); // sin campos de contexto editables
  });
});
