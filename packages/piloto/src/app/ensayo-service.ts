/**
 * Servicio de ensayo: registra cada ejecución de rehearsal como un ensayo distinto,
 * idempotente por identidad. La ORQUESTACIÓN del ciclo (contenido/publicación emulada/
 * medición/optimización/rollback) la conduce la capa de aplicación de la experiencia;
 * este servicio conserva el resultado, los pasos y las incidencias.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import { type EnsayoState, type PayloadEjecutado, EVENTOS_ENS, ensStreamId, reconstruirEnsayo } from '../domain/ensayo';

export class EnsayoService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, ensId: string): Promise<EnsayoState> {
    return this.store.readStream(ctx, ensStreamId(ensId)).then((e) => reconstruirEnsayo(ensId, String(ctx.organizationId), e));
  }

  async registrar(ctx: RequestContext, ensId: string, p: PayloadEjecutado, a: Attribution, o: string): Promise<EnsayoState> {
    const previo = await this.cargar(ctx, ensId);
    if (previo.existe) return previo; // idempotente por identidad de ensayo (repetición no duplica)
    await this.store.append(ctx, ensStreamId(ensId), previo.version, [{ type: EVENTOS_ENS.ejecutado, payload: p, attribution: a, occurredAt: o }]);
    return this.cargar(ctx, ensId);
  }
}
