/**
 * Proyecciones del Centro de Control (pausa, decisiones, buzón) — reconstruibles e
 * idempotentes. El resumen del departamento se compone en la capa de aplicación a
 * partir de estas y de las proyecciones de los demás módulos.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type DecisionState, aplicarDecision, estadoInicialDecision } from '../domain/decision';
import { type InboxState, aplicarInbox, estadoInicialInbox } from '../domain/inbox';
import { type PausaState, aplicarPausa, estadoInicialPausa } from '../domain/pausa';

export interface Snapshot<S> {
  readonly version: number;
  readonly state: S;
}
export interface PausaProjectionStore {
  get(org: string): Promise<Snapshot<PausaState> | null>;
  save(org: string, snap: Snapshot<PausaState>): Promise<void>;
  deleteAll(): Promise<void>;
}
export interface DecisionProjectionStore {
  get(org: string, id: string): Promise<Snapshot<DecisionState> | null>;
  save(org: string, id: string, snap: Snapshot<DecisionState>): Promise<void>;
  list(org: string): Promise<readonly DecisionState[]>;
  deleteAll(): Promise<void>;
}
export interface InboxProjectionStore {
  get(org: string): Promise<Snapshot<InboxState> | null>;
  save(org: string, snap: Snapshot<InboxState>): Promise<void>;
  deleteAll(): Promise<void>;
}
export interface ControlProjectionStores {
  readonly pausa: PausaProjectionStore;
  readonly decision: DecisionProjectionStore;
  readonly inbox: InboxProjectionStore;
}

export function parseControlStream(streamId: string): { tipo: 'pausa' | 'dec' | 'inbox'; id: string } | null {
  if (streamId.startsWith('pausa:')) return { tipo: 'pausa', id: streamId.slice('pausa:'.length) };
  if (streamId.startsWith('dec:')) return { tipo: 'dec', id: streamId.slice('dec:'.length) };
  if (streamId.startsWith('ctrlbox:')) return { tipo: 'inbox', id: streamId.slice('ctrlbox:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionControl(stores: ControlProjectionStores, event: RecordedEvent): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseControlStream(event.streamId);
  if (!ref) return 'ignored';
  const org = event.organizationId;
  if (ref.tipo === 'pausa') {
    const snap = await stores.pausa.get(org);
    const v = snap?.version ?? 0;
    if (event.sequence <= v) return 'skipped';
    if (event.sequence !== v + 1) throw new Error('hueco en proyección pausa');
    await stores.pausa.save(org, { version: event.sequence, state: aplicarPausa(snap?.state ?? estadoInicialPausa(org), event) });
    return 'applied';
  }
  if (ref.tipo === 'dec') {
    const snap = await stores.decision.get(org, ref.id);
    const v = snap?.version ?? 0;
    if (event.sequence <= v) return 'skipped';
    if (event.sequence !== v + 1) throw new Error('hueco en proyección dec');
    await stores.decision.save(org, ref.id, { version: event.sequence, state: aplicarDecision(snap?.state ?? estadoInicialDecision(ref.id, org), event) });
    return 'applied';
  }
  const snap = await stores.inbox.get(org);
  const v = snap?.version ?? 0;
  if (event.sequence <= v) return 'skipped';
  if (event.sequence !== v + 1) throw new Error('hueco en proyección inbox');
  await stores.inbox.save(org, { version: event.sequence, state: aplicarInbox(snap?.state ?? estadoInicialInbox(org), event) });
  return 'applied';
}

export class InMemoryPausaProjectionStore implements PausaProjectionStore {
  private readonly data = new Map<string, Snapshot<PausaState>>();
  async get(o: string) {
    return this.data.get(o) ?? null;
  }
  async save(o: string, s: Snapshot<PausaState>) {
    this.data.set(o, s);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryDecisionProjectionStore implements DecisionProjectionStore {
  private readonly data = new Map<string, Snapshot<DecisionState>>();
  private k(o: string, i: string) {
    return `${o}::${i}`;
  }
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: Snapshot<DecisionState>) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryInboxProjectionStore implements InboxProjectionStore {
  private readonly data = new Map<string, Snapshot<InboxState>>();
  async get(o: string) {
    return this.data.get(o) ?? null;
  }
  async save(o: string, s: Snapshot<InboxState>) {
    this.data.set(o, s);
  }
  async deleteAll() {
    this.data.clear();
  }
}
