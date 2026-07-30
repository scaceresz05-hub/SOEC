/**
 * Servicio de decisiones de marketing. Aplica la máquina de estados verificable y los
 * invariantes: una decisión NO_EVALUABLE no puede aprobarse ni ejecutarse; la ausencia de
 * información no se convierte en conclusión; toda transición inválida se rechaza. Acotado por
 * organización (`decmkt:<org>:<id>`). Event-sourced.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type DecisionMkt,
  type EntradaDecision,
  type EstadoDecision,
  EVENTOS_DECISION,
  decMktStreamId,
  esEvaluable,
  reconstruirDecision,
  transicionValida,
  validarEntrada,
} from '../domain/decision-mkt';
import { DecisionMktInvalidaError, TransicionInvalidaError } from '../domain/errors';

export class DecisionMktService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, decisionId: string): Promise<DecisionMkt> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, decMktStreamId(org, decisionId)).then((e) => reconstruirDecision(org, decisionId, e));
  }

  /** Crea la decisión. El estado inicial es NO_EVALUABLE si falta información obligatoria. */
  async crear(ctx: RequestContext, decisionId: string, entrada: EntradaDecision, a: Attribution, o: string): Promise<DecisionMkt> {
    if (entrada.organizacionId !== this.org(ctx)) throw new DecisionMktInvalidaError('organizacionId no coincide con el contexto');
    const errores = validarEntrada(entrada);
    if (errores.length > 0) throw new DecisionMktInvalidaError(`decisión inválida: ${errores.join(', ')}`);
    const estado = await this.cargar(ctx, decisionId);
    if (estado.existe) return estado;
    const estadoInicial: EstadoDecision = esEvaluable(entrada) ? 'PROPUESTA' : 'NO_EVALUABLE';
    const input: EventInput = {
      type: EVENTOS_DECISION.creada,
      payload: { ...entrada, estadoInicial },
      attribution: a,
      occurredAt: o,
      idempotencyKey: `crear:${decMktStreamId(this.org(ctx), decisionId)}`,
    };
    await this.store.append(ctx, decMktStreamId(this.org(ctx), decisionId), estado.version, [input]);
    return this.cargar(ctx, decisionId);
  }

  /** Transición gobernada por la máquina de estados. */
  async transicionar(ctx: RequestContext, decisionId: string, hacia: EstadoDecision, a: Attribution, o: string): Promise<DecisionMkt> {
    const d = await this.cargar(ctx, decisionId);
    if (!d.existe) throw new DecisionMktInvalidaError('la decisión no existe');
    if (!transicionValida(d.estado, hacia)) {
      throw new TransicionInvalidaError(`transición no permitida: ${d.estado} → ${hacia}`);
    }
    const input: EventInput = { type: EVENTOS_DECISION.transicionada, payload: { estado: hacia }, attribution: a, occurredAt: o };
    await this.store.append(ctx, decMktStreamId(this.org(ctx), decisionId), d.version, [input]);
    return this.cargar(ctx, decisionId);
  }

  /** Registra el resultado y pasa a EVALUADA (solo desde COMPLETADA/FALLIDA). */
  async evaluar(ctx: RequestContext, decisionId: string, resultado: string, a: Attribution, o: string): Promise<DecisionMkt> {
    const d = await this.cargar(ctx, decisionId);
    if (!transicionValida(d.estado, 'EVALUADA')) throw new TransicionInvalidaError(`no evaluable desde ${d.estado}`);
    const input: EventInput = { type: EVENTOS_DECISION.evaluada, payload: { resultado }, attribution: a, occurredAt: o };
    await this.store.append(ctx, decMktStreamId(this.org(ctx), decisionId), d.version, [input]);
    return this.cargar(ctx, decisionId);
  }
}
