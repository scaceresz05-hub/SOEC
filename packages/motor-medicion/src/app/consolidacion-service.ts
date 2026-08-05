/**
 * @soec/motor-medicion · aplicación · SERVICIO DE CONSOLIDACIÓN (M8).
 *
 * Consolida VARIAS evaluaciones comparables en un veredicto gobernado. Deriva la clave de cada evaluación
 * desde su cuerpo, EXCLUYE las incompatibles (con motivo), NO cuenta dos veces la misma observación, y sólo
 * transfiere con respaldo consistente en múltiples experimentos. No modifica evaluaciones históricas.
 * Idempotente por `consolidacionId`, multi-tenant, reconstruible. Toda consolidación SIMULADA conserva su
 * naturaleza.
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { consolidar, type ClaveComparacion, type EntradaConsolidacion } from '../dominio/consolidacion';
import {
  EVENTOS_CONSOLIDACION, type ConsolidacionState, claveDeEvaluacion, consolidacionStreamId, reconstruirConsolidacion,
} from '../dominio/consolidacion-operacion';
import { EvaluacionService } from './evaluacion-service';
import { ComandoMedicionInvalidoError } from '../dominio/errors';

const EVENTOS_CONS_INDICE = { registrada: 'consolidacion-indice.registrada' } as const;
function consIndiceStreamId(org: string): string { return `consolidacion-indice:${org}`; }

export class ConsolidacionService {
  constructor(private readonly store: EventStore, private readonly evaluaciones: EvaluacionService) {}
  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, consolidacionId: string): Promise<ConsolidacionState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, consolidacionStreamId(org, consolidacionId)).then((e) => reconstruirConsolidacion(org, consolidacionId, e));
  }

  /**
   * Consolida las evaluaciones `evaluacionIds` bajo `clave`. Sólo incluye las VIGENTES (EMITIDA) y compatibles;
   * las demás se excluyen con motivo. Idempotente por `consolidacionId`.
   */
  async consolidar(ctx: RequestContext, consolidacionId: string, clave: ClaveComparacion, evaluacionIds: readonly string[], a: Attribution, o: string): Promise<ConsolidacionState> {
    if (!consolidacionId?.trim()) throw new ComandoMedicionInvalidoError('consolidacionId es obligatorio');
    const existente = await this.cargar(ctx, consolidacionId);
    if (existente.existe) { await this.asegurarEnIndice(ctx, consolidacionId, a, o); return existente; } // idempotente

    const entradas: EntradaConsolidacion[] = [];
    for (const id of evaluacionIds) {
      const ev = await this.evaluaciones.cargar(ctx, id);
      if (!ev.existe) continue;
      const c = ev.cuerpo;
      if (ev.estado !== 'EMITIDA' || !c.hipotesis || !c.medicion) {
        // no vigente / incompleta ⇒ se computa como incompatible por clave (queda excluida con motivo)
        entradas.push({ evaluacionId: id, observacionId: c.observacionId, clave: { ...clave, contexto: `__no_vigente_${id}` }, estadoHipotesis: 'NO_EVALUABLE' });
        continue;
      }
      entradas.push({ evaluacionId: id, observacionId: c.observacionId, clave: claveDeEvaluacion(c), estadoHipotesis: c.hipotesis.estado });
    }
    const cuerpo = consolidar(clave, entradas);
    try {
      await this.store.append(ctx, consolidacionStreamId(this.org(ctx), consolidacionId), existente.version, [{ type: EVENTOS_CONSOLIDACION.emitida, payload: { clave, cuerpo }, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; } // dos consolidaciones concurrentes: convergen
    await this.asegurarEnIndice(ctx, consolidacionId, a, o);
    return this.cargar(ctx, consolidacionId);
  }

  private async asegurarEnIndice(ctx: RequestContext, consolidacionId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, consIndiceStreamId(org));
    if (events.some((e) => e.type === EVENTOS_CONS_INDICE.registrada && (e.payload as { consolidacionId: string }).consolidacionId === consolidacionId)) return;
    try {
      await this.store.append(ctx, consIndiceStreamId(org), events.length, [{ type: EVENTOS_CONS_INDICE.registrada, payload: { consolidacionId }, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listarIds(ctx: RequestContext): Promise<readonly string[]> {
    const events = await this.store.readStream(ctx, consIndiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_CONS_INDICE.registrada).map((e) => (e.payload as { consolidacionId: string }).consolidacionId);
  }
}
