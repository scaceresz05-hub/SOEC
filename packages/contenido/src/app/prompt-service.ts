/**
 * Servicio de plantillas de prompt: registrar versiones y publicar la vigente.
 * Los prompts son activos versionados; se conserva qué versión produjo cada pieza.
 */
import type { AppendResult, Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type ContenidoPrompt,
  EVENTOS_PROMPT,
  type PromptState,
  type VersionPrompt,
  huellaPrompt,
  promptStreamId,
  reconstruirPrompt,
  versionVigentePrompt,
} from '../domain/prompts';
import { ComandoContenidoInvalidoError } from '../domain/errors';

export class PromptService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, promptId: string): Promise<PromptState> {
    return this.store.readStream(ctx, promptStreamId(promptId)).then((e) => reconstruirPrompt(promptId, ctx.organizationId, e));
  }

  async vigente(ctx: RequestContext, promptId: string): Promise<VersionPrompt | null> {
    return versionVigentePrompt(await this.cargar(ctx, promptId));
  }

  async registrarVersion(
    ctx: RequestContext,
    promptId: string,
    contenido: ContenidoPrompt,
    attribution: Attribution,
    occurredAt: string,
  ): Promise<{ version: number; result: AppendResult }> {
    if (!contenido.plantilla || contenido.esquemaEsperado.length === 0) {
      throw new ComandoContenidoInvalidoError('Un prompt exige plantilla y esquema esperado');
    }
    const estado = await this.cargar(ctx, promptId);
    const version = Math.max(0, ...Object.keys(estado.versiones).map(Number)) + 1;
    const v: VersionPrompt = { ...contenido, version, vigenciaDesde: occurredAt, huella: huellaPrompt(contenido) };
    const result = await this.store.append(ctx, promptStreamId(promptId), estado.version, [
      { type: EVENTOS_PROMPT.registrado, payload: { version: v }, attribution, occurredAt },
    ]);
    return { version, result };
  }

  async publicar(ctx: RequestContext, promptId: string, version: number, attribution: Attribution, occurredAt: string): Promise<AppendResult> {
    const estado = await this.cargar(ctx, promptId);
    if (!estado.existe) throw new ComandoContenidoInvalidoError(`El prompt '${promptId}' no existe`);
    return this.store.append(ctx, promptStreamId(promptId), estado.version, [{ type: EVENTOS_PROMPT.publicado, payload: { version }, attribution, occurredAt }]);
  }
}
