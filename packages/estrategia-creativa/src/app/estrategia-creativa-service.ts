/**
 * @soec/estrategia-creativa · aplicación · Deriva la estrategia creativa desde el cerebro comercial y
 * la persiste (event-sourced, multi-tenant). Es la CONEXIÓN: consume `@soec/crm-comercial` (SSOT de
 * conocimiento comercial) y produce el insumo creativo que el pipeline existente sabe usar. No produce
 * efectos externos (sin publicación, sin gasto); una ABSTENCIÓN nunca se persiste como si fuera un plan.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { ConocimientoComercialService } from '@soec/crm-comercial';
import {
  type DerivacionCreativa,
  EVENTOS_ESTCREATIVA,
  type EstrategiaCreativaState,
  derivarCreativa,
  estrategiaCreativaStreamId,
  reconstruirEstrategiaCreativa,
} from '../domain/estrategia-creativa';

export class EstrategiaCreativaService {
  private readonly conocimiento: ConocimientoComercialService;
  constructor(private readonly store: EventStore, conocimiento?: ConocimientoComercialService) {
    this.conocimiento = conocimiento ?? new ConocimientoComercialService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext): Promise<EstrategiaCreativaState> {
    const org = this.org(ctx);
    return reconstruirEstrategiaCreativa(org, await this.store.readStream(ctx, estrategiaCreativaStreamId(org)));
  }

  /** Deriva (sin persistir) la estrategia creativa desde el conocimiento comercial actual. */
  async derivar(ctx: RequestContext): Promise<DerivacionCreativa> {
    return derivarCreativa(await this.conocimiento.cargar(ctx));
  }

  /**
   * Deriva y, si es evaluable (PROPUESTA), la registra como estrategia creativa vigente. Si ABSTIENE,
   * devuelve la abstención con sus faltantes SIN persistir nada.
   */
  async derivarYRegistrar(ctx: RequestContext, a: Attribution, occurredAt: string): Promise<DerivacionCreativa> {
    const res = await this.derivar(ctx);
    if (res.tipo === 'ABSTENCION') return res;
    const st = await this.cargar(ctx);
    const input: EventInput = { type: EVENTOS_ESTCREATIVA.derivada, payload: { brief: res.brief, estrategia: res.estrategia }, attribution: a, occurredAt };
    await this.store.append(ctx, estrategiaCreativaStreamId(this.org(ctx)), st.version, [input]);
    return res;
  }
}
