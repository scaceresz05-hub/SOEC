import { describe, expect, it } from 'vitest';
import {
  ActorId,
  type IntelligenceProvider,
  type IntelligenceRequest,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import { DeterministicIntelligenceProvider, offerToHumanJudgment } from '../src/index';

function ctx(): RequestContext {
  const organizationId = OrganizationId('orgA');
  return {
    organizationId,
    actor: ActorId('tester'),
    scope: { organizationId, permissions: ['intelligence:use'] },
    correlationId: 'c',
  };
}

const req = (input: string): IntelligenceRequest => ({
  operation: 'hypothesis',
  input,
  dataPolicy: 'must-stay-internal',
});

describe('Frontera de inteligencia (#13, C-5)', () => {
  it('produce un producto atribuido, con incertidumbre, que nunca es decisión vinculante', async () => {
    const p = new DeterministicIntelligenceProvider();
    const product = await p.operate(ctx(), req('la presión cae al arrancar tres bombas'));
    expect(product.bindingDecision).toBe(false);
    expect(product.attribution.source).toContain('intelligence:deterministic');
    expect(product.uncertainty).toBeTruthy();
    expect(product.provider).toBe('deterministic');
    expect(product.providerVersion).toBe('0.1.0');
  });

  it('puede abstenerse: «no sé» es un resultado legítimo (E4)', async () => {
    const p = new DeterministicIntelligenceProvider();
    const product = await p.operate(ctx(), req('   '));
    expect(product.abstained).toBe(true);
    expect(product.evidence).toHaveLength(0);
    expect(product.uncertainty).toBe('total');
  });

  it('respeta la cancelación', async () => {
    const p = new DeterministicIntelligenceProvider();
    const ac = new AbortController();
    ac.abort();
    await expect(p.operate(ctx(), req('x'), ac.signal)).rejects.toThrow();
  });

  it('el proveedor es reemplazable: cualquier adaptador satisface el puerto', async () => {
    const other: IntelligenceProvider = {
      name: 'otro',
      version: '9.9.9',
      operate: async () => ({
        kind: 'explanation',
        content: 'alternativo',
        attribution: {
          source: 'intelligence:otro@9.9.9',
          purpose: 'p',
          assumptions: [],
          claimType: 'interpretive',
          regime: 'empirical',
          uncertainty: 'baja',
        },
        uncertainty: 'baja',
        abstained: false,
        evidence: [],
        provider: 'otro',
        providerVersion: '9.9.9',
        bindingDecision: false,
      }),
    };
    const product = await other.operate(ctx(), req('x'));
    expect(product.provider).toBe('otro');
    expect(product.bindingDecision).toBe(false);
  });

  it('la soberanía se cierra en la persona: el producto solo se ofrece al juicio humano', async () => {
    const p = new DeterministicIntelligenceProvider();
    const product = await p.operate(ctx(), req('x'));
    const pending = offerToHumanJudgment(product);
    expect(pending.awaitingHumanJudgment).toBe(true);
    // No existe función que convierta el producto en decisión ejecutada.
  });
});
