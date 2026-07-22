/**
 * Servicio de identidad de marca: registrar versiones y publicar la vigente.
 * Append-only y versionado; una pieza histórica conserva la versión que la produjo.
 */
import type { AppendResult, Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type ContenidoMarca,
  EVENTOS_MARCA,
  type MarcaState,
  type VersionMarca,
  marcaStreamId,
  reconstruirMarca,
  versionVigenteMarca,
} from '../domain/marca';
import { ComandoContenidoInvalidoError } from '../domain/errors';

export class MarcaService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, marcaId: string): Promise<MarcaState> {
    return this.store.readStream(ctx, marcaStreamId(marcaId)).then((e) => reconstruirMarca(marcaId, ctx.organizationId, e));
  }

  async vigente(ctx: RequestContext, marcaId: string): Promise<VersionMarca | null> {
    return versionVigenteMarca(await this.cargar(ctx, marcaId));
  }

  async registrarVersion(
    ctx: RequestContext,
    marcaId: string,
    contenido: ContenidoMarca,
    attribution: Attribution,
    occurredAt: string,
  ): Promise<{ version: number; result: AppendResult }> {
    if (!contenido.nombre || !contenido.tono) throw new ComandoContenidoInvalidoError('Una marca exige nombre y tono');
    const estado = await this.cargar(ctx, marcaId);
    const version = Math.max(0, ...Object.keys(estado.versiones).map(Number)) + 1;
    const v: VersionMarca = { ...contenido, version, vigenciaDesde: occurredAt, atribucion: attribution };
    const result = await this.store.append(ctx, marcaStreamId(marcaId), estado.version, [
      { type: EVENTOS_MARCA.registrada, payload: { version: v }, attribution, occurredAt },
    ]);
    return { version, result };
  }

  async publicar(ctx: RequestContext, marcaId: string, version: number, attribution: Attribution, occurredAt: string): Promise<AppendResult> {
    const estado = await this.cargar(ctx, marcaId);
    if (!estado.existe) throw new ComandoContenidoInvalidoError(`La marca '${marcaId}' no existe`);
    return this.store.append(ctx, marcaStreamId(marcaId), estado.version, [{ type: EVENTOS_MARCA.publicada, payload: { version }, attribution, occurredAt }]);
  }
}
