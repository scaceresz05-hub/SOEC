/**
 * Servicio del buzón de control: registra alertas (deduplicadas) y notificaciones
 * internas, y permite resolver/ marcar su estado. No envía correos ni push reales.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type Alerta,
  type EstadoAlerta,
  type EstadoNotificacion,
  type InboxState,
  type Notificacion,
  EVENTOS_INBOX,
  inboxStreamId,
  reconstruirInbox,
} from '../domain/inbox';
import { esTipoAlertaValido } from '../domain/catalogo-base';
import { ComandoControlInvalidoError } from '../domain/errors';

export class InboxService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext): Promise<InboxState> {
    return this.store.readStream(ctx, inboxStreamId(String(ctx.organizationId))).then((e) => reconstruirInbox(String(ctx.organizationId), e));
  }
  private sid(ctx: RequestContext): string {
    return inboxStreamId(String(ctx.organizationId));
  }

  async registrarAlerta(ctx: RequestContext, alerta: Omit<Alerta, 'estado' | 'en'>, attribution: Attribution, occurredAt: string): Promise<InboxState> {
    if (!esTipoAlertaValido(alerta.tipo)) throw new ComandoControlInvalidoError(`Tipo de alerta inválido: '${alerta.tipo}'`);
    const s = await this.cargar(ctx);
    await this.store.append(ctx, this.sid(ctx), s.version, [{ type: EVENTOS_INBOX.alertaRegistrada, payload: { alerta }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }
  async resolverAlerta(ctx: RequestContext, clave: string, estado: EstadoAlerta, attribution: Attribution, occurredAt: string): Promise<InboxState> {
    const s = await this.cargar(ctx);
    await this.store.append(ctx, this.sid(ctx), s.version, [{ type: EVENTOS_INBOX.alertaResuelta, payload: { clave, estado }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }
  async registrarNotificacion(ctx: RequestContext, notificacion: Omit<Notificacion, 'estado' | 'en'>, attribution: Attribution, occurredAt: string): Promise<InboxState> {
    const s = await this.cargar(ctx);
    await this.store.append(ctx, this.sid(ctx), s.version, [{ type: EVENTOS_INBOX.notiRegistrada, payload: { notificacion }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }
  async marcarNotificacion(ctx: RequestContext, id: string, estado: EstadoNotificacion, attribution: Attribution, occurredAt: string): Promise<InboxState> {
    const s = await this.cargar(ctx);
    await this.store.append(ctx, this.sid(ctx), s.version, [{ type: EVENTOS_INBOX.notiMarcada, payload: { id, estado }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }
}
