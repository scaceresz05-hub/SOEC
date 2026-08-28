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
    expect(logs[0]!.errorMessage).toBe('field required'); // el mensaje de Google queda en el log durable
  });

  it('TRANSCODING "Unknown name": errorCode=null pero errorMessage CONSERVA el nombre del campo (punto ciego reparado)', async () => {
    // Un error de transcoding JSON de Google NO trae details[].errors[] (no hay errorCode); el nombre del campo
    // inválido vive SÓLO en error.message. Antes se descartaba → imposible diagnosticar. Ahora es durable.
    const msg = 'Invalid JSON payload received. Unknown name "foo" at \'mutate_operations[2].campaign_operation.create\': Cannot find field.';
    const f = fakeFetch({ ok: false, status: 400, requestId: 'REQ-TC', text: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: msg } }) });
    const logs: GoogleAdsWriteLog[] = [];
    const req = { mutateOperations: [{ campaignOperation: { create: {} } }], partialFailure: false as const, validateOnly: true as const };
    const r = await client({ fetchFn: f.fn as unknown as typeof fetch, logger: (l) => logs.push(l) }).mutarGrafo('8605539300', req);
    expect(r.ok).toBe(false);
    expect(r.errorStatus).toBe('INVALID_ARGUMENT');
    expect(r.errorCode).toBeNull();                       // transcoding ⇒ sin errorCode
    expect(r.errorMessage).toContain('Unknown name "foo"'); // el campo inválido queda expuesto
    expect(logs[0]!.errorMessage).toContain('mutate_operations[2].campaign_operation.create'); // y en el log durable
  });

  it('NO_ACCESS_TOKEN: sin token (causa del fallo previo) ⇒ falla cerrado ANTES de llamar a Google', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { results: [] } });
    await expect(client({ token: null, fetchFn: f.fn as unknown as typeof fetch }).aplicar(budgetOp)).rejects.toThrow(/NO_ACCESS_TOKEN/);
    expect(f.fn).not.toHaveBeenCalled(); // nunca se contactó a Google
  });

  it('mutarGrafo: POST a googleAds:mutate con la request completa (validateOnly + partialFailure) + parseo error', async () => {
    const okF = fakeFetch({ ok: true, status: 200, requestId: 'REQ-G', body: { results: [{}, {}] } });
    const req = { mutateOperations: [{ campaignBudgetOperation: { create: {} } }, { campaignOperation: { create: {} } }], partialFailure: false as const, validateOnly: true as const };
    const r = await client({ fetchFn: okF.fn as unknown as typeof fetch }).mutarGrafo('8605539300', req);
    expect(okF.last().url).toContain('/customers/8605539300/googleAds:mutate');
    expect(JSON.parse(okF.last().init.body as string).validateOnly).toBe(true);
    expect(r).toMatchObject({ ok: true, httpStatus: 200, requestId: 'REQ-G', validateOnly: true, operationCount: 2 });
    const errF = fakeFetch({ ok: false, status: 400, requestId: 'REQ-GE', text: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errors: [{ errorCode: { campaignError: 'DUPLICATE_NAME' }, message: 'x' }] }] } }) });
    const r2 = await client({ fetchFn: errF.fn as unknown as typeof fetch }).mutarGrafo('8605539300', req);
    expect(r2).toMatchObject({ ok: false, httpStatus: 400, requestId: 'REQ-GE', errorStatus: 'INVALID_ARGUMENT' });
    expect(r2.errorCode).toContain('campaignError');
  });

  it('GoogleAdsFailure: preserva location.fieldPathElements + trigger + deriva errorPath/operationIndex; múltiples errores en orden', async () => {
    // Fixture realista v25: fieldError:REQUIRED en Campaign.create (op 1) + un 2º error, con paths reales.
    const body = { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.', details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure', errors: [
      { errorCode: { fieldError: 'REQUIRED' }, message: 'The required field was not present.', trigger: { stringValue: '' }, location: { fieldPathElements: [{ fieldName: 'mutate_operations', index: 1 }, { fieldName: 'campaign_operation' }, { fieldName: 'create' }, { fieldName: 'target_spend' }] } },
      { errorCode: { campaignError: 'DUPLICATE_NAME' }, message: 'Duplicate campaign name.', location: { fieldPathElements: [{ fieldName: 'mutate_operations', index: 1 }, { fieldName: 'campaign_operation' }, { fieldName: 'create' }, { fieldName: 'name' }] } },
    ] }] } };
    const f = fakeFetch({ ok: false, status: 400, requestId: 'CDywt8', text: JSON.stringify(body) });
    const req = { mutateOperations: [{ campaignOperation: { create: {} } }], partialFailure: false as const, validateOnly: true as const };
    const r = await client({ fetchFn: f.fn as unknown as typeof fetch }).mutarGrafo('8605539300', req);
    expect(r.ok).toBe(false);
    expect(r.requestId).toBe('CDywt8');                         // I: requestId sobrevive
    expect(r.googleErrors).toHaveLength(2);                     // G: múltiples errores completos y en orden
    const e0 = r.googleErrors[0]!;
    expect(e0.errorCode).toBe('fieldError:REQUIRED');           // A
    expect(e0.message).toBe('The required field was not present.'); // B
    expect(e0.trigger).toBe('{"stringValue":""}');              // C: trigger sanitizado, sobrevive
    expect(e0.fieldPathElements).toEqual([{ fieldName: 'mutate_operations', index: 1 }, { fieldName: 'campaign_operation' }, { fieldName: 'create' }, { fieldName: 'target_spend' }]); // D
    expect(e0.errorPath).toBe('mutate_operations[1].campaign_operation.create.target_spend'); // E: derivado del path
    expect(e0.operationIndex).toBe(1);                          // F: sólo desde el index de Google
    expect(r.googleErrors[1]!.errorCode).toBe('campaignError:DUPLICATE_NAME');
    expect(r.googleErrors[1]!.errorPath).toBe('mutate_operations[1].campaign_operation.create.name');
    expect(JSON.stringify(r)).not.toMatch(/AT-123|DEV-TOKEN|Bearer/); // J: sin secretos
  });

  it('mutarGrafo SUCCESS: parsea mutateOperationResponses (aggregate) → resource names reales (no "0 creados")', async () => {
    // La respuesta del aggregate googleAds:mutate NO es results[] sino mutateOperationResponses[] con result por-tipo.
    const body = { mutateOperationResponses: [
      { campaignBudgetResult: { resourceName: 'customers/8605539300/campaignBudgets/111' } },
      { campaignResult: { resourceName: 'customers/8605539300/campaigns/24194332264' } },
      { adGroupResult: { resourceName: 'customers/8605539300/adGroups/222' } },
    ] };
    const f = fakeFetch({ ok: true, status: 200, requestId: 'z4X6', body });
    const req = { mutateOperations: [{ campaignBudgetOperation: { create: {} } }, { campaignOperation: { create: {} } }, { adGroupOperation: { create: {} } }], partialFailure: false as const };
    const r = await client({ fetchFn: f.fn as unknown as typeof fetch }).mutarGrafo('8605539300', req);
    expect(r.ok).toBe(true);
    expect(r.resultsCount).toBe(3);                         // 3 recursos REALES creados (antes: 0)
    expect(r.results.map((x) => x.resourceName)).toEqual(['customers/8605539300/campaignBudgets/111', 'customers/8605539300/campaigns/24194332264', 'customers/8605539300/adGroups/222']);
  });

  it('sugerirGeoTargets: parsea geoTargetConstantSuggestions → criterionId/canonicalName/targetType', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { geoTargetConstantSuggestions: [{ geoTargetConstant: { resourceName: 'geoTargetConstants/20154', id: '20154', name: 'Tarapacá', canonicalName: 'Tarapaca,Chile', targetType: 'Region', countryCode: 'CL', status: 'ENABLED' } }] } });
    const r = await client({ fetchFn: f.fn as unknown as typeof fetch }).sugerirGeoTargets(['Tarapacá'], 'CL');
    expect(f.last().url).toContain('/geoTargetConstants:suggest');
    expect(r[0]).toEqual({ name: 'Tarapacá', canonicalName: 'Tarapaca,Chile', criterionId: '20154', targetType: 'Region', countryCode: 'CL', status: 'ENABLED' });
  });

  it('validate exitoso no expone secretos en el log', async () => {
    const f = fakeFetch({ ok: true, status: 200, requestId: 'REQ-OK', body: { results: [] } });
    const logs: GoogleAdsWriteLog[] = [];
    await client({ validateOnly: true, fetchFn: f.fn as unknown as typeof fetch, logger: (l) => logs.push(l) }).aplicar(budgetOp);
    expect(logs[0]).toMatchObject({ ok: true, validateOnly: true, requestId: 'REQ-OK' });
    expect(JSON.stringify(logs)).not.toMatch(/AT-123|DEV-TOKEN|Bearer/);
  });
});
