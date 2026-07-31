/**
 * @soec/estrategia-creativa · aplicación · Servicio del artefacto de estrategia creativa (Tramo D).
 * Event-sourced, multi-tenant, versionado: cada CAMBIO real genera una nueva versión; re-derivar un
 * contenido idéntico no versiona (idempotente para el orquestador). Reconstruible por replay.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type ArtefactoCreativoState,
  type ContenidoArtefacto,
  EVENTOS_ARTEFACTO,
  artefactoCreativoStreamId,
  contenidoArtefactoCanonico,
  reconstruirArtefacto,
} from '../domain/artefacto-creativo';

export class EstrategiaCreativaArtefactoService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, estrategiaCreativaId: string): Promise<ArtefactoCreativoState> {
    const org = this.org(ctx);
    return reconstruirArtefacto(org, estrategiaCreativaId, await this.store.readStream(ctx, artefactoCreativoStreamId(org, estrategiaCreativaId)));
  }

  /** Registra o versiona el artefacto si su contenido cambió. Devuelve el estado y la versión vigente. */
  async establecer(ctx: RequestContext, estrategiaCreativaId: string, contenido: ContenidoArtefacto, a: Attribution, o: string): Promise<ArtefactoCreativoState> {
    const st = await this.cargar(ctx, estrategiaCreativaId);
    // Comparación CANÓNICA sólo del contenido (ignora metadata y orden de claves): re-derivar idéntico
    // NO versiona; sólo un cambio real de contenido incrementa la versión (B-1).
    const igual = st.existe && st.artefacto !== null && contenidoArtefactoCanonico(st.artefacto) === contenidoArtefactoCanonico(contenido);
    if (igual) return st; // sin cambios → no versiona
    const tipo = st.existe ? EVENTOS_ARTEFACTO.actualizada : EVENTOS_ARTEFACTO.registrada;
    const input: EventInput = { type: tipo, payload: contenido, attribution: a, occurredAt: o };
    await this.store.append(ctx, artefactoCreativoStreamId(this.org(ctx), estrategiaCreativaId), st.version, [input]);
    return this.cargar(ctx, estrategiaCreativaId);
  }
}
