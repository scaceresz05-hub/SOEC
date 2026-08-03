/**
 * @soec/motor-creativo · aplicación · Servicio de SOLICITUD DE APROBACIÓN canónica.
 *
 * `solicitar` es idempotente por (recurso, versión): dos reintentos no duplican la solicitud. `estado`
 * deriva el estado sin persistir un veredicto: PENDIENTE (sin aprobación humana), APROBADA (aprobada en
 * esa versión exacta vía `AprobacionService`), u OBSOLETA (la versión ya no es la vigente del recurso).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { AprobacionService } from '@soec/estrategia-creativa';
import {
  EVENTOS_SOLICITUD,
  type EstadoSolicitud,
  type SolicitudState,
  type TipoRecursoSolicitud,
  reconstruirSolicitud,
  solicitudDeterministaId,
  solicitudStreamId,
} from '../dominio/solicitud-aprobacion';

export class SolicitudAprobacionService {
  private readonly aprobacion: AprobacionService;
  constructor(private readonly store: EventStore, aprobacion?: AprobacionService) {
    this.aprobacion = aprobacion ?? new AprobacionService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, tipo: TipoRecursoSolicitud, resourceId: string): Promise<SolicitudState> {
    const org = this.org(ctx);
    return reconstruirSolicitud(org, tipo, resourceId, await this.store.readStream(ctx, solicitudStreamId(org, tipo, resourceId)));
  }

  /** Registra (idempotente por versión) una solicitud PENDIENTE. Devuelve su id determinista. */
  async solicitar(ctx: RequestContext, tipo: TipoRecursoSolicitud, resourceId: string, version: number, a: Attribution, o: string): Promise<string> {
    const org = this.org(ctx);
    const id = solicitudDeterministaId(org, tipo, resourceId, version);
    const st = await this.cargar(ctx, tipo, resourceId);
    if (st.solicitudes.some((s) => s.version === version)) return id; // idempotente
    const input: EventInput = { type: EVENTOS_SOLICITUD.registrada, payload: { solicitudId: id, version }, attribution: a, occurredAt: o };
    await this.store.append(ctx, solicitudStreamId(org, tipo, resourceId), st.version, [input]);
    return id;
  }

  /**
   * Estado de la solicitud para una versión, relativo a la versión VIGENTE del recurso: OBSOLETA si la
   * versión pedida ya no es la vigente; APROBADA si hay aprobación humana en esa versión; PENDIENTE si no.
   */
  async estado(ctx: RequestContext, tipo: TipoRecursoSolicitud, resourceId: string, version: number, versionVigente: number): Promise<EstadoSolicitud> {
    if (version !== versionVigente) return 'OBSOLETA';
    if (await this.aprobacion.estaAprobada(ctx, tipo, resourceId, version)) return 'APROBADA';
    return 'PENDIENTE';
  }
}
