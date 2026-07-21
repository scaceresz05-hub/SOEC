import {
  type IntellectualProduct,
  type IntelligenceProvider,
  type IntelligenceRequest,
  type RequestContext,
  SoecError,
  SovereigntyViolationError,
} from '@soec/contracts';

/**
 * Adaptador determinístico de la frontera de inteligencia (#13).
 * No llama a ningún SDK externo: el dominio jamás depende de un proveedor concreto.
 * Produce hipótesis atribuidas con incertidumbre; puede abstenerse; nunca decide.
 */
export class DeterministicIntelligenceProvider implements IntelligenceProvider {
  readonly name = 'deterministic';
  readonly version = '0.1.0';

  async operate(
    _ctx: RequestContext,
    req: IntelligenceRequest,
    signal?: AbortSignal,
  ): Promise<IntellectualProduct> {
    if (signal?.aborted) throw new SoecError('operación cancelada');

    // Abstención: entrada insuficiente → «no sé» es un resultado legítimo (E4).
    const abstain = req.input.trim().length === 0;

    return {
      kind: req.operation,
      content: abstain ? '' : `[${req.operation}] considérese: ${req.input}`,
      attribution: {
        source: `intelligence:${this.name}@${this.version}`,
        purpose: 'operar intelectualmente sobre el ECE',
        assumptions: ['adaptador determinístico de prueba'],
        claimType: 'interpretive',
        regime: 'empirical',
        uncertainty: abstain ? 'total' : 'alta',
      },
      uncertainty: abstain ? 'total' : 'declarada',
      abstained: abstain,
      evidence: abstain ? [] : [`entrada: ${req.input}`],
      provider: this.name,
      providerVersion: this.version,
      bindingDecision: false,
    };
  }
}

/** Representa una decisión que aún pertenece a la persona. No la ejecuta. */
export interface PendingHumanDecision {
  readonly product: IntellectualProduct;
  readonly awaitingHumanJudgment: true;
}

/**
 * Frontera de soberanía: un producto intelectual solo puede ofrecerse al juicio
 * humano. No existe camino que lo convierta automáticamente en decisión vinculante.
 */
export function offerToHumanJudgment(product: IntellectualProduct): PendingHumanDecision {
  if ((product as { bindingDecision: boolean }).bindingDecision === true) {
    throw new SovereigntyViolationError('Un producto no puede ser una decisión vinculante');
  }
  return { product, awaitingHumanJudgment: true };
}
