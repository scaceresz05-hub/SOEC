/**
 * Servicio de la bandeja de decisiones. Registra decisiones excepcionales y las
 * resuelve (aprobar/denegar/modificar/posponer/pedir evidencia) con control de permisos
 * por rol. Una decisión de alto riesgo exige el permiso `aprobar_alto_riesgo`.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type ContenidoDecision,
  type DecisionState,
  type EstadoDecision,
  EVENTOS_DEC,
  decStreamId,
  decisionResuelta,
  reconstruirDecision,
} from '../domain/decision';
import { type Rol, puede } from '../domain/roles';
import { DecisionNoEncontradaError, DecisionYaResueltaError, PermisoInsuficienteError } from '../domain/errors';

export class DecisionService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, decId: string): Promise<DecisionState> {
    return this.store.readStream(ctx, decStreamId(decId)).then((e) => reconstruirDecision(decId, String(ctx.organizationId), e));
  }

  async registrar(ctx: RequestContext, decId: string, contenido: ContenidoDecision, attribution: Attribution, occurredAt: string): Promise<DecisionState> {
    const previo = await this.cargar(ctx, decId);
    if (previo.existe) return previo; // idempotente
    await this.store.append(ctx, decStreamId(decId), previo.version, [{ type: EVENTOS_DEC.registrada, payload: { contenido }, attribution, occurredAt }]);
    return this.cargar(ctx, decId);
  }

  async resolver(
    ctx: RequestContext,
    decId: string,
    r: { estado: EstadoDecision; actor: string; rol: Rol; comentario?: string; modificacion?: string | null },
    attribution: Attribution,
    occurredAt: string,
  ): Promise<DecisionState> {
    const state = await this.cargar(ctx, decId);
    if (!state.existe) throw new DecisionNoEncontradaError(`La decisión '${decId}' no existe`);
    if (decisionResuelta(state.estado)) throw new DecisionYaResueltaError(`La decisión '${decId}' ya está resuelta`);
    if (!puede(r.rol, 'aprobar_decision')) throw new PermisoInsuficienteError(`El rol '${r.rol}' no puede resolver decisiones`);
    if (state.contenido?.riesgo === 'alto' && (r.estado === 'aprobada' || r.estado === 'modificada') && !puede(r.rol, 'aprobar_alto_riesgo')) {
      throw new PermisoInsuficienteError(`El rol '${r.rol}' no puede aprobar decisiones de alto riesgo`);
    }
    await this.store.append(ctx, decStreamId(decId), state.version, [
      { type: EVENTOS_DEC.resuelta, payload: { estado: r.estado, actor: r.actor, comentario: r.comentario ?? '', modificacion: r.modificacion ?? null }, attribution, occurredAt },
    ]);
    return this.cargar(ctx, decId);
  }
}
