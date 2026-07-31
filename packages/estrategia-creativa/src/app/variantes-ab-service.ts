/**
 * @soec/estrategia-creativa · aplicación · Servicio de variantes A/B (Tramo 4). Event-sourced,
 * multi-tenant, con control experimental (una variable por vez, constantes compartidas, hipótesis
 * obligatoria). Idempotente por varianteId. No produce efectos externos (simulado).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { EstrategiaCreativaInvalidaError } from '../domain/errors';
import {
  EVENTOS_AB,
  type EntradaVariante,
  type EstadoVariante,
  type ExperimentoABState,
  type VarianteAB,
  experimentoABStreamId,
  reconstruirExperimentoAB,
  validarVariante,
} from '../domain/variantes-ab';

export class VariantesABService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, piezaBaseId: string): Promise<ExperimentoABState> {
    const org = this.org(ctx);
    return reconstruirExperimentoAB(org, piezaBaseId, await this.store.readStream(ctx, experimentoABStreamId(org, piezaBaseId)));
  }

  private append(ctx: RequestContext, piezaBaseId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<{ version: number }> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, experimentoABStreamId(this.org(ctx), piezaBaseId), version, [input]);
  }

  /** Agrega una variante A/B con control experimental. Abre el experimento si no existía. */
  async agregarVariante(ctx: RequestContext, piezaBaseId: string, entrada: EntradaVariante, a: Attribution, o: string): Promise<ExperimentoABState> {
    if (!piezaBaseId?.trim()) throw new EstrategiaCreativaInvalidaError('piezaBaseId obligatorio');
    let st = await this.cargar(ctx, piezaBaseId);
    const val = validarVariante(st, entrada);
    if (!val.ok) throw new EstrategiaCreativaInvalidaError(val.motivo);
    if (!st.existe) {
      await this.append(ctx, piezaBaseId, st.version, EVENTOS_AB.abierto, { piezaBaseId }, a, o);
      st = await this.cargar(ctx, piezaBaseId);
    }
    if (st.variantes.some((v) => v.varianteId === entrada.varianteId)) return st; // idempotente
    const variante: VarianteAB = {
      varianteId: entrada.varianteId,
      piezaBaseId,
      hipotesisQuePrueba: entrada.hipotesisQuePrueba,
      elementoModificado: entrada.elementoModificado,
      diferenciaControlada: entrada.diferenciaControlada,
      elementosConstantes: entrada.elementosConstantes,
      criterioExito: entrada.criterioExito,
      estado: 'BORRADOR',
    };
    await this.append(ctx, piezaBaseId, st.version, EVENTOS_AB.variante, variante, a, o);
    return this.cargar(ctx, piezaBaseId);
  }

  async transicionar(ctx: RequestContext, piezaBaseId: string, varianteId: string, estado: EstadoVariante, a: Attribution, o: string): Promise<ExperimentoABState> {
    const st = await this.cargar(ctx, piezaBaseId);
    if (!st.variantes.some((v) => v.varianteId === varianteId)) throw new EstrategiaCreativaInvalidaError(`variante ${varianteId} no encontrada`);
    await this.append(ctx, piezaBaseId, st.version, EVENTOS_AB.transicion, { varianteId, estado }, a, o);
    return this.cargar(ctx, piezaBaseId);
  }
}
