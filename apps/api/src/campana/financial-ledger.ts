/**
 * apps/api · campana · LEDGER FINANCIERO (PURO). DOBLE hard cap independiente: el presupuesto del EXPERIMENTO
 * y el TOPE TOTAL del envelope. El gasto HISTÓRICO nunca reduce ninguno. En Fase 2A todos los gastos son 0.
 */
export interface EntradaLedger {
  readonly totalCap: number;
  readonly experimentBudget: number;
  readonly historicalSpend: number;
  readonly envelopeSpend: number;
  readonly committedSpend: number;
  readonly experimentSpend: number;
  readonly experimentCommittedSpend: number;
}

export interface FinancialLedger {
  readonly historicalSpend: number;
  readonly envelopeSpend: number;
  readonly committedSpend: number;
  readonly remainingEnvelopeCap: number;
  readonly experimentSpend: number;
  readonly experimentCommittedSpend: number;
  readonly remainingExperimentCap: number;
}

export function construirLedger(e: EntradaLedger): FinancialLedger {
  return {
    historicalSpend: e.historicalSpend,
    envelopeSpend: e.envelopeSpend,
    committedSpend: e.committedSpend,
    remainingEnvelopeCap: e.totalCap - e.envelopeSpend - e.committedSpend, // histórico EXCLUIDO
    experimentSpend: e.experimentSpend,
    experimentCommittedSpend: e.experimentCommittedSpend,
    remainingExperimentCap: e.experimentBudget - e.experimentSpend - e.experimentCommittedSpend,
  };
}

/** Ledger a cero (fase actual): sólo caps y gasto histórico. */
export function ledgerCero(totalCap: number, experimentBudget: number, historicalSpend: number): FinancialLedger {
  return construirLedger({ totalCap, experimentBudget, historicalSpend, envelopeSpend: 0, committedSpend: 0, experimentSpend: 0, experimentCommittedSpend: 0 });
}
