/**
 * @soec/cia · app · SERVICIO DE PRESUPUESTO (reservas, event-sourced).
 *
 * Gobierna el ciclo estimar → validar → reservar → confirmar | liberar sobre el límite de una capacidad.
 * `disponible = límite − confirmado − reservado_pendiente`. Idempotente por `reservaId`, multi-tenant.
 * Todo SIMULADO/ESTIMADO. Nunca dinero real.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import {
  EVENTOS_RESERVA, reservaStreamId, reconstruirReserva, type ReservaState,
} from '../dominio/reserva';
import { limiteEfectivo } from '../dominio/autorizacion';
import { ComandoCiaInvalidoError } from '../dominio/errors';
import { AutorizacionesService } from './autorizaciones-service';

const EVENTOS_INDICE = { registrada: 'cia-reserva-indice.registrada' } as const;
function indiceStreamId(org: string, capacidadId: string): string { return `cia-reserva-indice:${org}:${capacidadId}`; }

export class PresupuestoService {
  constructor(private readonly store: EventStore, private readonly autorizaciones: AutorizacionesService) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, reservaId: string): Promise<ReservaState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, reservaStreamId(org, reservaId)).then((e) => reconstruirReserva(org, reservaId, e));
  }

  private async append(ctx: RequestContext, reservaId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, reservaId);
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, reservaStreamId(this.org(ctx), reservaId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  private async reservasDe(ctx: RequestContext, capacidadId: string): Promise<readonly ReservaState[]> {
    const eventos = await this.store.readStream(ctx, indiceStreamId(this.org(ctx), capacidadId));
    const ids = new Set<string>();
    for (const e of eventos) if (e.type === EVENTOS_INDICE.registrada) ids.add((e.payload as { reservaId: string }).reservaId);
    const out: ReservaState[] = [];
    for (const id of ids) out.push(await this.cargar(ctx, id));
    return out;
  }

  /** Consumo confirmado (definitivo) de una capacidad. */
  async confirmado(ctx: RequestContext, capacidadId: string): Promise<number> {
    return (await this.reservasDe(ctx, capacidadId)).filter((r) => r.estado === 'CONFIRMADA').reduce((s, r) => s + r.monto, 0);
  }

  /** Reservado pendiente (bloqueado, aún no confirmado ni liberado). */
  async reservadoPendiente(ctx: RequestContext, capacidadId: string): Promise<number> {
    return (await this.reservasDe(ctx, capacidadId)).filter((r) => r.estado === 'RESERVADA').reduce((s, r) => s + r.monto, 0);
  }

  /** Disponible = límite efectivo − confirmado − reservado pendiente. */
  async disponible(ctx: RequestContext, capacidadId: string): Promise<number> {
    const auth = await this.autorizaciones.cargar(ctx, capacidadId);
    const usado = (await this.confirmado(ctx, capacidadId)) + (await this.reservadoPendiente(ctx, capacidadId));
    return Math.max(0, limiteEfectivo(auth) - usado);
  }

  /** Valida y reserva. Devuelve true si reservó; false si no había disponible. Idempotente por reservaId. */
  async reservar(ctx: RequestContext, reservaId: string, capacidadId: string, monto: number, a: Attribution, o: string): Promise<boolean> {
    if (monto < 0) throw new ComandoCiaInvalidoError('el monto no puede ser negativo');
    const st = await this.cargar(ctx, reservaId);
    if (st.existe) return st.estado === 'RESERVADA'; // idempotente
    if (monto > 0 && monto > (await this.disponible(ctx, capacidadId))) return false; // sin margen
    await this.append(ctx, reservaId, EVENTOS_RESERVA.reservada, { capacidadId, monto }, a, o);
    await this.asegurarEnIndice(ctx, capacidadId, reservaId, a, o);
    return true;
  }

  async confirmar(ctx: RequestContext, reservaId: string, a: Attribution, o: string): Promise<ReservaState> {
    const st = await this.cargar(ctx, reservaId);
    if (st.estado === 'RESERVADA') await this.append(ctx, reservaId, EVENTOS_RESERVA.confirmada, {}, a, o);
    return this.cargar(ctx, reservaId);
  }

  async liberar(ctx: RequestContext, reservaId: string, a: Attribution, o: string): Promise<ReservaState> {
    const st = await this.cargar(ctx, reservaId);
    if (st.estado === 'RESERVADA') await this.append(ctx, reservaId, EVENTOS_RESERVA.liberada, {}, a, o);
    return this.cargar(ctx, reservaId);
  }

  async expirar(ctx: RequestContext, reservaId: string, a: Attribution, o: string): Promise<ReservaState> {
    const st = await this.cargar(ctx, reservaId);
    if (st.estado === 'RESERVADA') await this.append(ctx, reservaId, EVENTOS_RESERVA.expirada, {}, a, o);
    return this.cargar(ctx, reservaId);
  }

  async cancelar(ctx: RequestContext, reservaId: string, a: Attribution, o: string): Promise<ReservaState> {
    const st = await this.cargar(ctx, reservaId);
    if (st.estado === 'RESERVADA') await this.append(ctx, reservaId, EVENTOS_RESERVA.cancelada, {}, a, o);
    return this.cargar(ctx, reservaId);
  }

  /** Reservas huérfanas: RESERVADA cuyo plan asociado ya no está activo (lo decide el reconciliador). */
  async listarReservas(ctx: RequestContext, capacidadId: string): Promise<readonly ReservaState[]> { return this.reservasDe(ctx, capacidadId); }

  private async asegurarEnIndice(ctx: RequestContext, capacidadId: string, reservaId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const eventos = await this.store.readStream(ctx, indiceStreamId(org, capacidadId));
    if (eventos.some((e) => e.type === EVENTOS_INDICE.registrada && (e.payload as { reservaId: string }).reservaId === reservaId)) return;
    const input: EventInput = { type: EVENTOS_INDICE.registrada, payload: { reservaId }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, indiceStreamId(org, capacidadId), eventos.length, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }
}
