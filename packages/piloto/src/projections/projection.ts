/**
 * Proyecciones de piloto (organización, expediente, ensayos) — reconstruibles e idempotentes.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type EnsayoState, aplicarEnsayo, estadoInicialEnsayo } from '../domain/ensayo';
import { type ExpedienteState, aplicarExpediente, estadoInicialExpediente } from '../domain/expediente';
import { type OrgState, aplicarOrg, estadoInicialOrg } from '../domain/organizacion';

export interface Snap<S> {
  readonly version: number;
  readonly state: S;
}
export interface OrgProjectionStore {
  get(org: string, id: string): Promise<Snap<OrgState> | null>;
  save(org: string, id: string, s: Snap<OrgState>): Promise<void>;
  list(org: string): Promise<readonly OrgState[]>;
  deleteAll(): Promise<void>;
}
export interface ExpProjectionStore {
  get(org: string, id: string): Promise<Snap<ExpedienteState> | null>;
  save(org: string, id: string, s: Snap<ExpedienteState>): Promise<void>;
  list(org: string): Promise<readonly ExpedienteState[]>;
  deleteAll(): Promise<void>;
}
export interface EnsProjectionStore {
  get(org: string, id: string): Promise<Snap<EnsayoState> | null>;
  save(org: string, id: string, s: Snap<EnsayoState>): Promise<void>;
  list(org: string): Promise<readonly EnsayoState[]>;
  deleteAll(): Promise<void>;
}
export interface PilotoProjectionStores {
  readonly organizacion: OrgProjectionStore;
  readonly expediente: ExpProjectionStore;
  readonly ensayo: EnsProjectionStore;
}

export function parsePilotoStream(streamId: string): { tipo: 'org' | 'exp' | 'ens'; id: string } | null {
  if (streamId.startsWith('org:')) return { tipo: 'org', id: streamId.slice('org:'.length) };
  if (streamId.startsWith('exp:')) return { tipo: 'exp', id: streamId.slice('exp:'.length) };
  if (streamId.startsWith('ens:')) return { tipo: 'ens', id: streamId.slice('ens:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionPiloto(stores: PilotoProjectionStores, event: RecordedEvent): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parsePilotoStream(event.streamId);
  if (!ref) return 'ignored';
  const org = event.organizationId;
  if (ref.tipo === 'org') {
    const snap = await stores.organizacion.get(org, ref.id);
    const v = snap?.version ?? 0;
    if (event.sequence <= v) return 'skipped';
    if (event.sequence !== v + 1) throw new Error('hueco en proyección org');
    await stores.organizacion.save(org, ref.id, { version: event.sequence, state: aplicarOrg(snap?.state ?? estadoInicialOrg(ref.id, org), event) });
    return 'applied';
  }
  if (ref.tipo === 'exp') {
    const snap = await stores.expediente.get(org, ref.id);
    const v = snap?.version ?? 0;
    if (event.sequence <= v) return 'skipped';
    if (event.sequence !== v + 1) throw new Error('hueco en proyección exp');
    await stores.expediente.save(org, ref.id, { version: event.sequence, state: aplicarExpediente(snap?.state ?? estadoInicialExpediente(ref.id, org), event) });
    return 'applied';
  }
  const snap = await stores.ensayo.get(org, ref.id);
  const v = snap?.version ?? 0;
  if (event.sequence <= v) return 'skipped';
  if (event.sequence !== v + 1) throw new Error('hueco en proyección ens');
  await stores.ensayo.save(org, ref.id, { version: event.sequence, state: aplicarEnsayo(snap?.state ?? estadoInicialEnsayo(ref.id, org), event) });
  return 'applied';
}

class Mem<S> {
  protected readonly data = new Map<string, Snap<S>>();
  protected k(o: string, i: string) {
    return `${o}::${i}`;
  }
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: Snap<S>) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryOrgProjectionStore extends Mem<OrgState> implements OrgProjectionStore {}
export class InMemoryExpProjectionStore extends Mem<ExpedienteState> implements ExpProjectionStore {}
export class InMemoryEnsProjectionStore extends Mem<EnsayoState> implements EnsProjectionStore {}
