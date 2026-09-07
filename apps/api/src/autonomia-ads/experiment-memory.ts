/**
 * apps/api · autonomia-ads · MEMORIA DE EXPERIMENTOS (event-sourced, por organización).
 *
 * Persiste el aprendizaje de cada experimento para que el SIGUIENTE lo consuma y NO repita errores ya observados.
 * Idempotente por `experimentId` (una campaña + motivo de cierre ⇒ un aprendizaje). Durable (sobrevive reinicios).
 * Stream: `experimento-memoria:<org>` (log inmutable; se pliega al estado actual). No borra nada.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { RecommendedAction } from './director-postmortem';

export const EVENTO_APRENDIZAJE = 'experimento-memoria.aprendizaje';
export function experimentMemoryStreamId(org: string): string { return `experimento-memoria:${org}`; }

export interface ExperimentLearning {
  readonly experimentId: string;              // p.ej. `${campaignId}:${stopReason ?? 'ended'}`
  readonly campaignId: string;
  readonly at: string;
  readonly hypothesis: string | null;
  readonly configuration: Readonly<Record<string, unknown>>;   // presupuesto/keywords/matchTypes/bidding/geo (resumen)
  readonly results: Readonly<Record<string, number | null>>;   // spend/clicks/contacts/conversions/avgCpc…
  readonly stopReason: string | null;
  readonly postmortemSummary: string;
  readonly learning: string;                  // enunciado reutilizable ("qué aprendimos")
  readonly nextRecommendation: RecommendedAction;
  readonly avoidAction: RecommendedAction | null;  // acción a NO repetir (error ya observado)
}

/** Forma que consume el motor del director para no repetir errores. */
export interface AprendizajePrevio { readonly enunciado: string; readonly evitarAccion?: RecommendedAction }

const ATR: Attribution = {
  source: 'director-experiment-memory',
  purpose: 'memoria de aprendizajes de experimentos de marketing para informar la siguiente recomendación',
  assumptions: ['un experimentId ⇒ un aprendizaje (idempotente); sólo lectura de evidencia ya persistida'],
  claimType: 'observational', regime: 'empirical', uncertainty: 'baja',
};

export class ExperimentMemoryService {
  constructor(private readonly store: EventStore) {}

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('director-experiment-memory'),
      scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `experiment-memory-${org}` };
  }

  /** Registra el aprendizaje de un experimento. Idempotente: si ya existe uno con el mismo experimentId, no duplica. */
  async registrar(org: string, learning: ExperimentLearning): Promise<{ registrado: boolean }> {
    const ctx = this.ctx(org);
    const sid = experimentMemoryStreamId(org);
    const prev = await this.store.readStream(ctx, sid);
    const yaExiste = prev.some((e) => e.type === EVENTO_APRENDIZAJE && (e.payload as ExperimentLearning).experimentId === learning.experimentId);
    if (yaExiste) return { registrado: false };
    await this.store.append(ctx, sid, prev.length, [{ type: EVENTO_APRENDIZAJE, payload: learning, attribution: ATR, occurredAt: learning.at }])
      .catch(() => undefined); // tolera carrera (otro tick registró el mismo experimento)
    return { registrado: true };
  }

  /** Todos los aprendizajes registrados (orden cronológico). */
  async listar(org: string): Promise<ExperimentLearning[]> {
    const eventos = await this.store.readStream(this.ctx(org), experimentMemoryStreamId(org));
    return eventos.filter((e) => e.type === EVENTO_APRENDIZAJE).map((e) => e.payload as ExperimentLearning);
  }

  /** Aprendizajes previos para el motor (excluye opcionalmente el experimento en curso). */
  async aprendizajesPrevios(org: string, excludeExperimentId?: string): Promise<AprendizajePrevio[]> {
    const todos = await this.listar(org);
    return todos.filter((l) => l.experimentId !== excludeExperimentId)
      .map((l) => ({ enunciado: l.learning, ...(l.avoidAction ? { evitarAccion: l.avoidAction } : {}) }));
  }
}
