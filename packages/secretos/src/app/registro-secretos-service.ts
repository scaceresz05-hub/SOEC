/**
 * @soec/secretos · aplicación · Servicio de GOBERNANZA de referencias de secreto (M4-B). Event-sourced,
 * multi-tenant, determinista. Registra y rota referencias por `nombreLogico`; guarda SÓLO metadatos
 * (`secretRef`, versión de rotación, actor, instante). NUNCA maneja ni devuelve el VALOR de un secreto:
 * el dominio sólo conoce referencias (Art. 4). La resolución del valor es del adaptador `SecretStore`.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { esReferenciaSecreto } from '@soec/plataforma-capacidades';
import { SecretoInvalidoError, SecretoNoEncontradoError } from '../domain/errors';
import {
  type RegistroSecretoIndice,
  type RegistroSecretoState,
  EVENTOS_SECRETO,
  EVENTOS_SECRETO_INDICE,
  reconstruirRegistroSecreto,
  reconstruirRegistroSecretoIndice,
  registroSecretoIndiceStreamId,
  registroSecretoStreamId,
} from '../domain/registro';

export class RegistroSecretosService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private validarRef(secretRef: string): string {
    if (!esReferenciaSecreto(secretRef?.trim() ?? '')) {
      throw new SecretoInvalidoError('secretRef debe ser una REFERENCIA opaca de la allowlist (nunca el valor del secreto, Art. 4)');
    }
    return secretRef.trim();
  }

  async cargar(ctx: RequestContext, nombreLogico: string): Promise<RegistroSecretoState> {
    const org = this.org(ctx);
    return reconstruirRegistroSecreto(org, nombreLogico, await this.store.readStream(ctx, registroSecretoStreamId(org, nombreLogico)));
  }

  async listar(ctx: RequestContext): Promise<RegistroSecretoIndice> {
    return reconstruirRegistroSecretoIndice(this.org(ctx), await this.store.readStream(ctx, registroSecretoIndiceStreamId(this.org(ctx))));
  }

  /** Registra una referencia de secreto bajo un nombre lógico. Idempotente; asegura el índice. */
  async registrar(ctx: RequestContext, nombreLogico: string, secretRef: string, actor: string, a: Attribution, o: string): Promise<void> {
    if (!nombreLogico?.trim()) throw new SecretoInvalidoError('nombreLogico es obligatorio');
    if (!actor?.trim()) throw new SecretoInvalidoError('actor es obligatorio');
    const ref = this.validarRef(secretRef);
    const st = await this.cargar(ctx, nombreLogico);
    if (!st.existe) {
      const ev: EventInput = { type: EVENTOS_SECRETO.registrada, payload: { secretRef: ref, actor: actor.trim(), en: o }, attribution: a, occurredAt: o };
      await this.store.append(ctx, registroSecretoStreamId(this.org(ctx), nombreLogico), st.version, [ev]);
    }
    await this.asegurarEnIndice(ctx, nombreLogico, a, o);
  }

  /** Rota la referencia (Art. 7): apunta a una nueva `secretRef` e incrementa el contador de rotaciones. */
  async rotar(ctx: RequestContext, nombreLogico: string, nuevoSecretRef: string, actor: string, a: Attribution, o: string): Promise<RegistroSecretoState> {
    const st = await this.cargar(ctx, nombreLogico);
    if (!st.existe) throw new SecretoNoEncontradoError(`referencia de secreto ${nombreLogico} no encontrada`);
    if (!actor?.trim()) throw new SecretoInvalidoError('actor es obligatorio');
    const ref = this.validarRef(nuevoSecretRef);
    if (ref === st.secretRef) return st; // idempotente: misma referencia no rota
    const ev: EventInput = { type: EVENTOS_SECRETO.rotada, payload: { secretRef: ref, actor: actor.trim(), en: o }, attribution: a, occurredAt: o };
    await this.store.append(ctx, registroSecretoStreamId(this.org(ctx), nombreLogico), st.version, [ev]);
    return this.cargar(ctx, nombreLogico);
  }

  private async asegurarEnIndice(ctx: RequestContext, nombreLogico: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirRegistroSecretoIndice(org, await this.store.readStream(ctx, registroSecretoIndiceStreamId(org)));
    if (idx.nombres.includes(nombreLogico)) return;
    const ev: EventInput = { type: EVENTOS_SECRETO_INDICE.registrada, payload: { nombreLogico }, attribution: a, occurredAt: o };
    await this.store.append(ctx, registroSecretoIndiceStreamId(org), idx.version, [ev]);
  }
}
