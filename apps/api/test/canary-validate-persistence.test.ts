/**
 * REGRESIÓN de la persistencia del validate. Bug demostrado: `real()` construye un RequestContext con
 * SÓLO `events:read`; `store.append` exige `events:append` (requireScope) ⇒ el append LANZABA y el
 * `.catch(() => undefined)` lo tragaba, dejando `GET /medicion/canary-attempts` con `validateAttempts: []`
 * aunque Google hubiera devuelto el error completo. Aquí se fija el contrato del store + ctx que usa la ruta.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';

const ORG = 'org-smileflow';
const o = OrganizationId(ORG);
const ATR: Attribution = { source: 'canary-execute', purpose: 'intento auditable', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
const ctxRead: RequestContext = { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c' };
const ctxAppend = (c: RequestContext): RequestContext => ({ ...c, scope: { ...c.scope, permissions: [...c.scope.permissions, 'events:append'] } });
const sid = `canary-attempts:${ORG}`;
const MSG = 'Invalid JSON payload received. Unknown name "startDate" at \'mutate_operations[1].campaign_operation.create\': Cannot find field.';

describe('persistencia canary-validate-attempt', () => {
  it('K: el ctx SÓLO-lectura de real() hace fallar el append (causa raíz demostrada)', async () => {
    const store = new InMemoryEventStore();
    await expect(store.append(ctxRead, sid, 0, [{ type: 'canary-validate-attempt', payload: {}, attribution: ATR, occurredAt: '2026-08-27T00:00:00.000Z' }]))
      .rejects.toThrow(/events:append/);
  });

  it('K/L: con ctxAppend el evento se persiste y reaparece con el errorMessage COMPLETO (sin truncar)', async () => {
    const store = new InMemoryEventStore();
    const cw = ctxAppend(ctxRead);
    const prev = await store.readStream(cw, sid);
    const googleErrors = [{ errorCode: 'fieldError:REQUIRED', message: 'The required field was not present.', trigger: null, fieldPathElements: [{ fieldName: 'mutate_operations', index: 1 }, { fieldName: 'campaign_operation' }, { fieldName: 'create' }, { fieldName: 'target_spend' }], errorPath: 'mutate_operations[1].campaign_operation.create.target_spend', operationIndex: 1 }];
    await store.append(cw, sid, prev.length, [{ type: 'canary-validate-attempt', payload: { ok: false, httpStatus: 400, errorStatus: 'INVALID_ARGUMENT', errorCode: 'fieldError:REQUIRED', errorMessage: MSG, requestId: 'CDywt8', operationCount: 65, googleErrors }, attribution: ATR, occurredAt: '2026-08-27T00:00:00.000Z' }]);
    // Lectura como la del GET: filtra por type y devuelve el payload.
    const eventos = await store.readStream(ctxRead, sid);
    const validateAttempts = eventos.filter((e) => e.type === 'canary-validate-attempt').map((e) => e.payload as { errorMessage: string; operationCount: number; requestId: string; googleErrors: Array<{ errorPath: string; operationIndex: number; fieldPathElements: unknown[] }> });
    expect(validateAttempts).toHaveLength(1);
    expect(validateAttempts[0]!.operationCount).toBe(65);
    expect(validateAttempts[0]!.requestId).toBe('CDywt8');   // I: requestId sobrevive en la persistencia
    expect(validateAttempts[0]!.errorMessage).toBe(MSG);
    // H: la evidencia detallada (path derivado + fieldPathElements) sobrevive el round-trip del store.
    expect(validateAttempts[0]!.googleErrors[0]!.errorPath).toBe('mutate_operations[1].campaign_operation.create.target_spend');
    expect(validateAttempts[0]!.googleErrors[0]!.operationIndex).toBe(1);
    expect(validateAttempts[0]!.googleErrors[0]!.fieldPathElements).toHaveLength(4);
  });
});
