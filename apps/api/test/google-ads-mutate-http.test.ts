/**
 * Transporte HTTP de escritura Google Ads: headers correctos (developer-token + login-customer-id manager),
 * validate_only preservado en el body, parsing del error de Google (status/errorCode/request-id), NO_ACCESS_TOKEN
 * (la causa demostrada del fallo previo), y Campaign Total Budget (CUSTOM_PERIOD, 15.000M, sin daily). Sin red real.
 */
import { describe, expect, it, vi } from 'vitest';
import { GoogleAdsMutateHttpClient, type GoogleAdsWriteLog } from '../src/campana/google-ads-mutate-http';
import type { GoogleAdsOperation } from '../src/campana/google-ads-real-port';

const budgetOp: GoogleAdsOperation = { customerId: '8605539300', operation: 'campaign_budget.create', resourceType: 'campaign_budget', fields: { period: 'CUSTOM_PERIOD', totalAmountMicros: 15_000_000_000, explicitlyShared: false } };
const LOGIN = '1742063041'; // manager (MCC)

function fakeFetch(res: { ok: boolean; status: number; requestId?: string; body?: unknown; text?: string }): { fn: ReturnType<typeof vi.fn>; last: () => { url: string; init: RequestInit } } {
  let captured: { url: string; init: RequestInit } = { url: '', init: {} };
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    captured = { url: String(url), init };
    return {
      ok: res.ok, status: res.status,
      headers: { get: (k: string) => (k.toLowerCase() === 'request-id' ? res.requestId ?? null : null) },
      text: async () => res.text ?? JSON.stringify(res.body ?? {}),
      json: async () => res.body ?? {},
    };
  });
  return { fn, last: () => captured };
}
const client = (opts: { validateOnly?: boolean; token?: string | null; fetchFn: typeof fetch; logger?: (l: GoogleAdsWriteLog) => void }) =>
  new GoogleAdsMutateHttpClient({ resolverAccessToken: async () => (opts.token === undefined ? 'AT-123' : opts.token), developerToken: 'DEV-TOKEN', loginCustomerId: LOGIN, ...(opts.validateOnly ? { validateOnly: true } : {}), ...(opts.logger ? { logger: opts.logger } : {}), fetchFn: opts.fetchFn });

describe('GoogleAdsMutateHttpClient', () => {
  it('A/B/J: headers (Bearer + developer-token + login-customer-id manager) · URL · Campaign Total Budget', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { results: [{ resourceName: 'customers/8605539300/campaignBudgets/1' }] } });
    await client({ fetchFn: f.fn as unknown as typeof fetch }).aplicar(budgetOp);
    const { url, init } = f.last();
    expect(url).toContain('googleads.googleapis.com/v25/customers/8605539300/campaignBudgets:mutate');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer AT-123');
    expect(h['developer-token']).toBe('DEV-TOKEN');
    expect(h['login-customer-id']).toBe(LOGIN); // manager, sin guiones
    const body = JSON.parse(init.body as string) as { operations: Array<{ create: { period: string; totalAmountMicros: number; explicitlyShared: boolean } }>; validateOnly?: boolean };
    expect(body.operations[0]!.create.period).toBe('CUSTOM_PERIOD');
    expect(body.operations[0]!.create.totalAmountMicros).toBe(15_000_000_000);
    expect(body.operations[0]!.create.explicitlyShared).toBe(false);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('dailybudget');
    expect(body.validateOnly).toBeUndefined(); // sin validateOnly ⇒ no aparece
  });

  it('F: validate_only=true se preserva en el body y NO inventa resourceName', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { results: [] } }); // Google no crea recurso en validate
    const r = await client({ validateOnly: true, fetchFn: f.fn as unknown as typeof fetch }).aplicar(budgetOp);
    const body = JSON.parse(f.last().init.body as string) as { validateOnly?: boolean };
    expect(body.validateOnly).toBe(true);
    expect(r.resourceName).toBe('VALIDATE_ONLY_OK');
  });

  it('G/H: error de Google ⇒ conserva status/errorCode/request-id (log + throw, sin secretos)', async () => {
    const f = fakeFetch({ ok: false, status: 400, requestId: 'REQ-ERR-9', text: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'bad', details: [{ errors: [{ errorCode: { fieldError: 'REQUIRED' }, message: 'field required' }] }] } }) });
    const logs: GoogleAdsWriteLog[] = [];
    await expect(client({ fetchFn: f.fn as unknown as typeof fetch, logger: (l) => logs.push(l) }).aplicar(budgetOp)).rejects.toThrow(/GOOGLE_MUTATE_HTTP_400.*INVALID_ARGUMENT.*fieldError.*req=REQ-ERR-9/);
    expect(logs[0]).toMatchObject({ httpStatus: 400, requestId: 'REQ-ERR-9', errorStatus: 'INVALID_ARGUMENT', ok: false, loginCustomerId: LOGIN });
    expect(logs[0]!.errorCode).toContain('fieldError');
  });

  it('NO_ACCESS_TOKEN: sin token (causa del fallo previo) ⇒ falla cerrado ANTES de llamar a Google', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { results: [] } });
    await expect(client({ token: null, fetchFn: f.fn as unknown as typeof fetch }).aplicar(budgetOp)).rejects.toThrow(/NO_ACCESS_TOKEN/);
    expect(f.fn).not.toHaveBeenCalled(); // nunca se contactó a Google
  });

  it('validate exitoso no expone secretos en el log', async () => {
    const f = fakeFetch({ ok: true, status: 200, requestId: 'REQ-OK', body: { results: [] } });
    const logs: GoogleAdsWriteLog[] = [];
    await client({ validateOnly: true, fetchFn: f.fn as unknown as typeof fetch, logger: (l) => logs.push(l) }).aplicar(budgetOp);
    expect(logs[0]).toMatchObject({ ok: true, validateOnly: true, requestId: 'REQ-OK' });
    expect(JSON.stringify(logs)).not.toMatch(/AT-123|DEV-TOKEN|Bearer/);
  });
});
