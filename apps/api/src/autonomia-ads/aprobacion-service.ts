/**
 * apps/api · CAPA DE COMPOSICIÓN · G2-A · APROBACIÓN HUMANA REAL (reemplaza la aprobación SIMULADA de G1).
 *
 * Event-sourced (`aprobacion-ads:<org>:<intencionId>`). Estados: PENDIENTE_APROBACION / APROBADA / RECHAZADA /
 * EXPIRADA. Cablea `@soec/autonomia`: al aprobar, otorga una autorización humana gobernada (que respeta PAUSA y
 * queda en el stream de autonomía). SOEC NO puede aprobarse a sí mismo (actorHumano obligatorio y ≠ 'soec').
 * Registra: actorHumano, fechaHora, org, campaignId, acción, antes, después, evidencia, confianza, riesgo, límites.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { AutonomiaService } from '@soec/autonomia';

export type EstadoAprobacion = 'PENDIENTE_APROBACION' | 'APROBADA' | 'RECHAZADA' | 'EXPIRADA';

/** Acción gobernada de @soec/autonomia usada para la negativa (aplicar una optimización sobre la campaña). */
const ACCION_GOBERNADA = 'APLICAR_OPTIMIZACION' as const;

export interface MetaAprobacion {
  readonly campaignId: string;
  readonly accion: string;      // p. ej. ADD_NEGATIVE_KEYWORD
  readonly entidadRef: string;  // término
  readonly antes: string;
  readonly despues: string;
  readonly evidencia: string;
  readonly confianza: string;
  readonly riesgo: string;
  readonly limites: readonly string[];
}

export interface AprobacionState {
  readonly existe: boolean;
  readonly estado: EstadoAprobacion;
  readonly org: string;
  readonly intencionId: string;
  readonly meta: MetaAprobacion | null;
  readonly actorHumano: string | null;
  readonly fechaHora: string | null;
  readonly authorizationRef: string | null;
  readonly expiraEn: string | null;
  readonly motivo: string | null;
}

/** SOEC no es un actor humano válido para aprobar. */
export class AutoaprobacionProhibidaError extends Error {}

const EVENTOS = {
  solicitada: 'aprobacion.solicitada',
  aprobada: 'aprobacion.aprobada',
  rechazada: 'aprobacion.rechazada',
} as const;

function streamId(org: string, intencionId: string): string {
  return `aprobacion-ads:${org}:${intencionId}`;
}

export class AprobacionService {
  private readonly autonomia: AutonomiaService;
  constructor(private readonly store: EventStore) {
    this.autonomia = new AutonomiaService(store);
  }

  private async append(ctx: RequestContext, intencionId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    await this.store.append(ctx, streamId(String(ctx.organizationId), intencionId), version, [input]);
  }

  private async reconstruir(ctx: RequestContext, intencionId: string): Promise<{ st: AprobacionState; version: number }> {
    const org = String(ctx.organizationId);
    const eventos = await this.store.readStream(ctx, streamId(org, intencionId));
    let st: AprobacionState = { existe: false, estado: 'PENDIENTE_APROBACION', org, intencionId, meta: null, actorHumano: null, fechaHora: null, authorizationRef: null, expiraEn: null, motivo: null };
    for (const e of eventos) {
      const p = e.payload as Record<string, unknown>;
      if (e.type === EVENTOS.solicitada) st = { ...st, existe: true, estado: 'PENDIENTE_APROBACION', meta: p.meta as MetaAprobacion, expiraEn: p.expiraEn as string };
      else if (e.type === EVENTOS.aprobada) st = { ...st, estado: 'APROBADA', actorHumano: p.actorHumano as string, fechaHora: p.fechaHora as string, authorizationRef: p.authorizationRef as string };
      else if (e.type === EVENTOS.rechazada) st = { ...st, estado: 'RECHAZADA', actorHumano: p.actorHumano as string, fechaHora: p.fechaHora as string, motivo: p.motivo as string };
    }
    return { st, version: eventos.length };
  }

  /** Solicita aprobación humana (PENDIENTE_APROBACION), registrando toda la metadata. */
  async solicitar(ctx: RequestContext, intencionId: string, meta: MetaAprobacion, expiraEn: string, a: Attribution, o: string): Promise<AprobacionState> {
    const { st, version } = await this.reconstruir(ctx, intencionId);
    if (st.existe) return st; // idempotente
    await this.append(ctx, intencionId, version, EVENTOS.solicitada, { meta, expiraEn }, a, o);
    return (await this.reconstruir(ctx, intencionId)).st;
  }

  /** Estado con expiración: si sigue PENDIENTE y `ahora` > expiraEn ⇒ EXPIRADA. */
  async estado(ctx: RequestContext, intencionId: string, ahora: string): Promise<AprobacionState> {
    const { st } = await this.reconstruir(ctx, intencionId);
    if (st.estado === 'PENDIENTE_APROBACION' && st.expiraEn && ahora > st.expiraEn) return { ...st, estado: 'EXPIRADA' };
    return st;
  }

  /**
   * Aprueba con un actor HUMANO. SOEC no puede aprobarse a sí mismo. Rechaza si la aprobación ya expiró.
   * Cablea @soec/autonomia: otorga la autorización humana gobernada y devuelve su ref.
   */
  async aprobar(ctx: RequestContext, intencionId: string, actorHumano: string, ahora: string, a: Attribution, o: string): Promise<AprobacionState> {
    if (!actorHumano?.trim() || actorHumano.trim().toLowerCase() === 'soec') {
      throw new AutoaprobacionProhibidaError('la aprobación exige un actor HUMANO; SOEC no puede aprobarse a sí mismo');
    }
    const actual = await this.estado(ctx, intencionId, ahora);
    if (!actual.existe) throw new Error(`no hay aprobación pendiente para ${intencionId}`);
    if (actual.estado === 'EXPIRADA') throw new Error('la aprobación expiró; solicitar una nueva');
    if (actual.estado !== 'PENDIENTE_APROBACION') return actual; // ya resuelta
    // Cableado real con @soec/autonomia: otorgar la autorización humana (respeta PAUSA/gobernanza).
    const org = String(ctx.organizationId);
    const before = await this.autonomia.cargar(ctx);
    const authorizationRef = `auth:${org}:${ACCION_GOBERNADA}:${actual.meta!.entidadRef}:${before.autorizaciones.length + 1}`;
    await this.autonomia.otorgarAutorizacion(ctx, { accion: ACCION_GOBERNADA, entidadRef: actual.meta!.entidadRef, actorHumano, otorgadaEn: ahora, expiraEn: actual.expiraEn ?? ahora }, a, o);
    const { version } = await this.reconstruir(ctx, intencionId);
    await this.append(ctx, intencionId, version, EVENTOS.aprobada, { actorHumano, fechaHora: ahora, authorizationRef }, a, o);
    return (await this.reconstruir(ctx, intencionId)).st;
  }

  async rechazar(ctx: RequestContext, intencionId: string, actorHumano: string, motivo: string, ahora: string, a: Attribution, o: string): Promise<AprobacionState> {
    if (!actorHumano?.trim()) throw new AutoaprobacionProhibidaError('rechazar exige un actor humano identificado');
    const { st, version } = await this.reconstruir(ctx, intencionId);
    if (!st.existe || st.estado !== 'PENDIENTE_APROBACION') return st;
    await this.append(ctx, intencionId, version, EVENTOS.rechazada, { actorHumano, fechaHora: ahora, motivo }, a, o);
    return (await this.reconstruir(ctx, intencionId)).st;
  }
}
