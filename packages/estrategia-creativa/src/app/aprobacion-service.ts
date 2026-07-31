/**
 * @soec/estrategia-creativa · aplicación · Servicio de APROBACIÓN humana granular (Tramo G). Registra
 * decisiones humanas por recurso+versión, event-sourced y multi-tenant. NUNCA autoaprueba: el actor
 * humano (o un piloto claramente identificado) queda registrado en cada decisión. Consultar `estaAprobada`
 * antes de ejecutar cualquier cosa: si el recurso cambió de versión, la aprobación previa ya no vale.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type Aprobacion,
  type AprobacionState,
  type DecisionAprobacion,
  type TipoRecurso,
  EVENTOS_APROBACION,
  aprobacionStreamId,
  estaAprobada,
  reconstruirAprobacion,
} from '../domain/aprobacion';

export interface DecisionInput {
  readonly resourceType: TipoRecurso;
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly decision: DecisionAprobacion;
  readonly comment?: string;
  readonly scope?: string;
}

export class AprobacionService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, tipo: TipoRecurso, resourceId: string): Promise<AprobacionState> {
    const org = this.org(ctx);
    return reconstruirAprobacion(org, tipo, resourceId, await this.store.readStream(ctx, aprobacionStreamId(org, tipo, resourceId)));
  }

  /**
   * Registra una decisión humana. `actorUserId` proviene SIEMPRE del contexto autenticado (nunca del
   * payload): quien decide es quien está firmando la sesión. Idempotente por (recurso, versión, decisión,
   * actor): repetir la misma decisión no agrega ruido al historial.
   */
  async decidir(ctx: RequestContext, input: DecisionInput, a: Attribution, occurredAt: string): Promise<AprobacionState> {
    const org = this.org(ctx);
    const actorUserId = String(ctx.actor);
    const st = await this.cargar(ctx, input.resourceType, input.resourceId);
    const ya = st.ultima;
    if (ya && ya.resourceVersion === input.resourceVersion && ya.decision === input.decision && ya.actorUserId === actorUserId) return st;
    const aprobacion: Aprobacion = {
      approvalId: `apr-${org}-${input.resourceType}-${input.resourceId}-v${input.resourceVersion}-${st.version + 1}`,
      organizationId: org,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceVersion: input.resourceVersion,
      actorUserId,
      decision: input.decision,
      comment: input.comment ?? '',
      scope: input.scope ?? input.resourceType,
      timestamp: occurredAt,
    };
    const ev: EventInput = { type: EVENTOS_APROBACION.decidida, payload: aprobacion, attribution: a, occurredAt };
    await this.store.append(ctx, aprobacionStreamId(org, input.resourceType, input.resourceId), st.version, [ev]);
    return this.cargar(ctx, input.resourceType, input.resourceId);
  }

  /** ¿El recurso, en ESA versión exacta, está aprobado? (una versión nueva no hereda la aprobación). */
  async estaAprobada(ctx: RequestContext, tipo: TipoRecurso, resourceId: string, resourceVersion: number): Promise<boolean> {
    return estaAprobada(await this.cargar(ctx, tipo, resourceId), resourceVersion);
  }
}
