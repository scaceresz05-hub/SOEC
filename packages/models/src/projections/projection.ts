/**
 * Proyecciones actuales de MED y MDM: estado reconstruible a partir de la historia.
 *
 * Reemplazables y reconstruibles (§13): borrar y reconstruir produce el mismo
 * resultado; procesar dos veces no duplica (idempotencia por secuencia); una
 * organización no contamina otra; MED y MDM nunca se fusionan (stores separados).
 */
import type { RecordedEvent } from '@soec/contracts';
import { type ModelInstanceState, type ModelType, aplicar, estadoInicial } from '../domain/model';

export interface ProjectionSnapshot {
  readonly version: number;
  readonly state: ModelInstanceState;
}

/** Almacén de proyecciones de modelo, separado por tipo de modelo. */
export interface ModelProjectionStore {
  get(modelType: ModelType, organizationId: string, instanceId: string): Promise<ProjectionSnapshot | null>;
  save(modelType: ModelType, organizationId: string, instanceId: string, snapshot: ProjectionSnapshot): Promise<void>;
  list(modelType: ModelType, organizationId: string): Promise<readonly ModelInstanceState[]>;
  deleteAll(): Promise<void>;
}

export interface StreamRef {
  readonly modelType: ModelType;
  readonly instanceId: string;
}

/** Deriva el modelo y la instancia desde el stream. Devuelve null para streams ajenos (p. ej. enlaces). */
export function parseStream(streamId: string): StreamRef | null {
  const sep = streamId.indexOf(':');
  if (sep < 0) return null;
  const prefix = streamId.slice(0, sep);
  const instanceId = streamId.slice(sep + 1);
  if (prefix === 'med') return { modelType: 'MED', instanceId };
  if (prefix === 'mdm') return { modelType: 'MDM', instanceId };
  return null;
}

/**
 * Aplica un evento a la proyección correspondiente, de forma idempotente:
 * si el evento ya fue aplicado (secuencia ≤ versión proyectada) se ignora.
 */
export async function aplicarEventoAProyeccion(
  store: ModelProjectionStore,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseStream(event.streamId);
  if (!ref) return 'ignored'; // enlaces u otros streams: no proyectados aquí
  const snap = await store.get(ref.modelType, event.organizationId, ref.instanceId);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped'; // ya aplicado → idempotente
  if (event.sequence !== version + 1) {
    // Hueco de secuencia: la proyección incremental no es segura. Se reconstruye desde cero.
    throw new Error(
      `Hueco de secuencia en proyección ${ref.modelType}/${ref.instanceId}: esperado ${version + 1}, recibido ${event.sequence}`,
    );
  }
  const base = snap?.state ?? estadoInicial(ref.instanceId, ref.modelType, event.organizationId);
  const nextState = aplicar(base, event);
  await store.save(ref.modelType, event.organizationId, ref.instanceId, {
    version: event.sequence,
    state: nextState,
  });
  return 'applied';
}

/** Almacén de proyecciones en memoria (para pruebas del runner). */
export class InMemoryProjectionStore implements ModelProjectionStore {
  private readonly data = new Map<string, ProjectionSnapshot>();

  private key(modelType: ModelType, org: string, instanceId: string): string {
    return `${modelType}::${org}::${instanceId}`;
  }

  async get(modelType: ModelType, org: string, instanceId: string): Promise<ProjectionSnapshot | null> {
    return this.data.get(this.key(modelType, org, instanceId)) ?? null;
  }

  async save(modelType: ModelType, org: string, instanceId: string, snapshot: ProjectionSnapshot): Promise<void> {
    this.data.set(this.key(modelType, org, instanceId), snapshot);
  }

  async list(modelType: ModelType, org: string): Promise<readonly ModelInstanceState[]> {
    const prefix = `${modelType}::${org}::`;
    return [...this.data.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v.state);
  }

  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}
