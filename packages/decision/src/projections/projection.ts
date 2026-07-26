/**
 * Proyección de decisión (vigente + historial) — reconstruible e idempotente.
 * Clave de proyección: Organización + Departamento.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type DecisionState, aplicarDecision, estadoInicialDecision } from '../domain/decision';

export interface Snap<S> {
  readonly version: number;
  readonly state: S;
}

export interface DecisionProjectionStore {
  get(org: string, departamentoId: string): Promise<Snap<DecisionState> | null>;
  save(org: string, departamentoId: string, s: Snap<DecisionState>): Promise<void>;
  list(org: string): Promise<readonly DecisionState[]>;
  deleteAll(): Promise<void>;
}

export function parseDecisionStream(
  streamId: string,
  organizationId: string,
): { departamentoId: string } | null {
  const prefijo = `objdecision:${organizationId}:`;
  if (streamId.startsWith(prefijo)) return { departamentoId: streamId.slice(prefijo.length) };
  return null;
}

export async function aplicarEventoAProyeccionDecision(
  store: DecisionProjectionStore,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseDecisionStream(event.streamId, event.organizationId);
  if (!ref) return 'ignored';
  const org = event.organizationId;
  const snap = await store.get(org, ref.departamentoId);
  const v = snap?.version ?? 0;
  if (event.sequence <= v) return 'skipped';
  if (event.sequence !== v + 1) throw new Error('hueco en proyección decision');
  await store.save(org, ref.departamentoId, {
    version: event.sequence,
    state: aplicarDecision(snap?.state ?? estadoInicialDecision(org, ref.departamentoId), event),
  });
  return 'applied';
}

class Mem implements DecisionProjectionStore {
  private readonly data = new Map<string, Snap<DecisionState>>();
  private k(o: string, i: string) {
    return `${o}::${i}`;
  }
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: Snap<DecisionState>) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryDecisionProjectionStore extends Mem {}
