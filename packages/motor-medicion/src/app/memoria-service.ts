/**
 * @soec/motor-medicion · aplicación · MEMORIA OPERACIONAL (event-sourced, append-only).
 *
 * Registra el HISTÓRICO de lo intentado (una entrada por evaluación emitida): qué hipótesis, KPI y segmento.
 * La VIGENCIA (respaldada/refutada/obsoleta) se DERIVA del estado actual de las evaluaciones, no se persiste
 * aquí — así la memoria conserva el histórico aunque una evaluación pase a OBSOLETA. Idempotente por
 * `evaluacionId`, multi-tenant, reconstruible por replay.
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';

const EVENTOS_MEMORIA = { entrada: 'memoria.entrada' } as const;
function memoriaStreamId(org: string): string { return `memoria:${org}`; }

export interface EntradaMemoria {
  readonly hipotesisId: string | null;
  readonly kpiId: string;
  readonly segmento: string;
}

export interface RegistroMemoria extends EntradaMemoria {
  readonly evaluacionId: string;
}

export class MemoriaService {
  constructor(private readonly store: EventStore) {}
  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  /** Registra una entrada histórica (idempotente por evaluacionId; convergente ante concurrencia). */
  async registrar(ctx: RequestContext, evaluacionId: string, entrada: EntradaMemoria, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, memoriaStreamId(org));
    if (events.some((e) => e.type === EVENTOS_MEMORIA.entrada && (e.payload as RegistroMemoria).evaluacionId === evaluacionId)) return;
    const payload: RegistroMemoria = { evaluacionId, ...entrada };
    try {
      await this.store.append(ctx, memoriaStreamId(org), events.length, [{ type: EVENTOS_MEMORIA.entrada, payload, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listar(ctx: RequestContext): Promise<readonly RegistroMemoria[]> {
    const events = await this.store.readStream(ctx, memoriaStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_MEMORIA.entrada).map((e) => e.payload as RegistroMemoria);
  }

  async estaRegistrada(ctx: RequestContext, evaluacionId: string): Promise<boolean> {
    return (await this.listar(ctx)).some((r) => r.evaluacionId === evaluacionId);
  }
}
