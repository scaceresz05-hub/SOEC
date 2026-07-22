/**
 * Servicio de webhooks entrantes (F2-CHAN-01 §14). Valida la firma, resuelve la
 * publicación por su referencia externa, deduplica (idempotente), aplica el estado
 * mediante reglas de transición y protege el cuerpo bruto. Ignora de forma segura
 * eventos de publicaciones desconocidas; impide replay y regresión de estado.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { EVENTOS_PUB, type EstadoPublicacion, pubStreamId } from '../domain/publication';
import { type WebhookEntrante, validarFirmaWebhook } from '../domain/webhook';
import { WebhookInvalidoError } from '../domain/errors';
import type { PublicationService } from './publication-service';

export type ResultadoWebhook = 'aplicado' | 'duplicado' | 'ignorado' | 'sin_efecto';

function estadoDesdeStatus(status: string): EstadoPublicacion {
  if (status === 'published') return 'verificada';
  if (status === 'deleted') return 'retirada';
  if (status === 'processing' || status === 'accepted') return 'procesando';
  return 'reconciliando';
}

export class WebhookService {
  constructor(
    private readonly store: EventStore,
    private readonly publicaciones: PublicationService,
  ) {}

  async procesar(ctx: RequestContext, wh: WebhookEntrante, attribution: Attribution, occurredAt: string): Promise<{ resultado: ResultadoWebhook; motivo: string }> {
    if (!validarFirmaWebhook(wh.id, wh.tipo, wh.externalRef, wh.status, wh.firma)) {
      throw new WebhookInvalidoError('firma de webhook inválida');
    }
    const publicationId = await this.publicaciones.resolverPorReferencia(ctx, wh.externalRef);
    if (!publicationId) return { resultado: 'ignorado', motivo: 'referencia externa desconocida' }; // ignora seguro

    const state = await this.publicaciones.cargar(ctx, publicationId);
    if (state.webhooksAplicados.includes(wh.id)) return { resultado: 'duplicado', motivo: 'webhook ya aplicado (dedup/replay)' };

    const nuevoEstado = estadoDesdeStatus(wh.status);
    const input: EventInput = { type: EVENTOS_PUB.webhook, payload: { webhookId: wh.id, tipo: wh.tipo, status: wh.status, nuevoEstado }, attribution, occurredAt };
    await this.store.append(ctx, pubStreamId(publicationId), state.version, [input]);

    const releido = await this.publicaciones.cargar(ctx, publicationId);
    // Si el reducer rechazó la transición (webhook fuera de orden), el estado no cambió.
    const aplico = releido.webhooksAplicados.includes(wh.id) && releido.estado !== state.estado;
    return { resultado: aplico ? 'aplicado' : 'sin_efecto', motivo: aplico ? `estado → ${releido.estado}` : 'sin cambio de estado (transición no válida o ya al día)' };
  }
}
