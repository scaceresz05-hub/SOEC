/**
 * RECONCILIACIÓN post-mutate exitoso: los resource names REALES → providerBindings, sin fabricar IDs, idempotente,
 * sin llamar a Google. Si la evidencia durable NO trae resource names (intentos previos al fix) ⇒ EVIDENCE_INSUFFICIENT.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ResourceBindingService } from '../src/campana/resource-binding';
import { bindingsDesdeOperaciones, reconciliarBindings, type OperacionResuelta } from '../src/campana/canary-reconciliation';
import type { AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';

const ORG = 'org-smileflow';
const T = '2026-08-28T14:17:59.395Z';
const ENV = { id: 'env:org-smileflow:371c91ff00c6a837', organizationId: ORG, planHash: '371c91ff00c6a837' } as AuthorizedExecutionEnvelope;
// Grafo resuelto: budget (sin binding), campaign, adGroup, ad, keyword, negative — con resource names reales.
const OPS: OperacionResuelta[] = [
  { operationIndex: 0, resourceType: 'campaignBudgetOperation', resourceName: 'customers/8605539300/campaignBudgets/111' },
  { operationIndex: 1, resourceType: 'campaignOperation', resourceName: 'customers/8605539300/campaigns/24194332264' },
  { operationIndex: 2, resourceType: 'adGroupOperation', resourceName: 'customers/8605539300/adGroups/222' },
  { operationIndex: 3, resourceType: 'adGroupAdOperation', resourceName: 'customers/8605539300/adGroupAds/333' },
  { operationIndex: 4, resourceType: 'adGroupCriterionOperation', resourceName: 'customers/8605539300/adGroupCriteria/444' },
  { operationIndex: 5, resourceType: 'campaignCriterionOperation', resourceName: 'customers/8605539300/campaignCriteria/555' },
];

describe('reconciliación de bindings post-mutate', () => {
  it('D: sólo bindea recursos con resourceName REAL (budget sin EntityType se omite; null no fabrica)', () => {
    const conNull = [...OPS, { operationIndex: 6, resourceType: 'campaignOperation', resourceName: null }];
    const bs = bindingsDesdeOperaciones(ORG, ENV, conNull, T);
    expect(bs).toHaveLength(5); // 6 ops con nombre − budget(sin entidad) = 5; el null se omite
    expect(bs.every((b) => b.providerResourceId && b.providerResourceId.startsWith('customers/8605539300/'))).toBe(true);
    expect(bs.find((b) => b.entityType === 'campaign')?.providerResourceId).toBe('customers/8605539300/campaigns/24194332264');
    expect(bs.some((b) => b.entityType === 'campaign' && b.providerResourceId?.includes('campaignBudgets'))).toBe(false);
  });
  it('A/B/C: registra bindings desde resource names reales por índice y expone la campaña vinculada', async () => {
    const svc = new ResourceBindingService(new InMemoryEventStore());
    const r = await reconciliarBindings(svc, ORG, ENV, OPS, T);
    expect(r.ok).toBe(true);
    expect(r.bindingsRegistrados).toBe(5);
    expect(r.providerBindingsTotal).toBe(5);
    expect(r.boundCampaignResourceName).toBe('customers/8605539300/campaigns/24194332264');
    expect(r.newGoogleWriteCalls).toBe(0);
  });
  it('E: idempotente — reconciliar dos veces NO duplica bindings', async () => {
    const svc = new ResourceBindingService(new InMemoryEventStore());
    await reconciliarBindings(svc, ORG, ENV, OPS, T);
    const r2 = await reconciliarBindings(svc, ORG, ENV, OPS, '2026-08-29T00:00:00.000Z');
    expect(r2.bindingsRegistrados).toBe(0);   // nada nuevo
    expect(r2.bindingsYaExistian).toBe(5);
    expect(r2.providerBindingsTotal).toBe(5); // total sin cambios
    expect((await svc.listar(ORG)).length).toBe(5);
  });
  it('§2: evidencia sin resource names ⇒ EVIDENCE_INSUFFICIENT (no fabrica, no llama a Google)', async () => {
    const svc = new ResourceBindingService(new InMemoryEventStore());
    const sinNombres: OperacionResuelta[] = OPS.map((o) => ({ ...o, resourceName: null }));
    const r = await reconciliarBindings(svc, ORG, ENV, sinNombres, T);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.bindingsRegistrados).toBe(0);
    expect(r.newGoogleWriteCalls).toBe(0);
    expect((await svc.listar(ORG)).length).toBe(0);
  });
});
