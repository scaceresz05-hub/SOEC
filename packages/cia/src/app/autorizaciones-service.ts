/**
 * @soec/cia · app · SERVICIO DE AUTORIZACIONES.
 *
 * El usuario autoriza CAPACIDADES (resultados), con un límite y un nivel de autonomía. Nunca herramientas.
 * Autorizar, fijar límite, suspender (kill de la capacidad) y reactivar son actos HUMANOS con traza.
 * Event-sourced, idempotente e multi-tenant (todo bajo `ctx.organizationId`). No hay proveedor en el dominio.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { buscarCapacidad } from '../dominio/catalogo';
import {
  EVENTOS_AUTORIZACION, autorizacionStreamId, reconstruirAutorizacion,
  type AutorizacionState, type NivelAutonomia,
} from '../dominio/autorizacion';
import { CapacidadDesconocidaError, ComandoCiaInvalidoError } from '../dominio/errors';

const EVENTOS_INDICE = { registrada: 'cia-autorizacion-indice.registrada' } as const;
function indiceStreamId(org: string): string { return `cia-autorizacion-indice:${org}`; }

export class AutorizacionesService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, capacidadId: string): Promise<AutorizacionState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, autorizacionStreamId(org, capacidadId)).then((e) => reconstruirAutorizacion(org, capacidadId, e));
  }

  private async append(ctx: RequestContext, capacidadId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, capacidadId);
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, autorizacionStreamId(this.org(ctx), capacidadId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  /** Registra la solicitud de una capacidad. Idempotente. */
  async solicitar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    if (!buscarCapacidad(capacidadId)) throw new CapacidadDesconocidaError(`Capacidad de marketing desconocida: ${capacidadId}`);
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.solicitada, {}, a, o);
    await this.asegurarEnIndice(ctx, capacidadId, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Acto HUMANO: autoriza la capacidad con un límite y un nivel de autonomía. */
  async autorizar(ctx: RequestContext, capacidadId: string, opts: { limite: number; nivelAutonomia: NivelAutonomia; actorHumano: string }, a: Attribution, o: string): Promise<AutorizacionState> {
    if (!buscarCapacidad(capacidadId)) throw new CapacidadDesconocidaError(`Capacidad de marketing desconocida: ${capacidadId}`);
    if (!opts.actorHumano?.trim()) throw new ComandoCiaInvalidoError('Autorizar una capacidad exige un actor humano (no puede autoautorizarse).');
    if (opts.limite < 0) throw new ComandoCiaInvalidoError('El límite no puede ser negativo.');
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.solicitada, {}, a, o);
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.autorizada, { limite: opts.limite, nivelAutonomia: opts.nivelAutonomia, actorHumano: opts.actorHumano }, a, o);
    await this.asegurarEnIndice(ctx, capacidadId, a, o);
    return this.cargar(ctx, capacidadId);
  }

  async fijarLimite(ctx: RequestContext, capacidadId: string, limite: number, a: Attribution, o: string): Promise<AutorizacionState> {
    if (limite < 0) throw new ComandoCiaInvalidoError('El límite no puede ser negativo.');
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.limiteFijado, { limite }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Kill de la capacidad (suspende). Acto humano; reversible. */
  async suspender(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.suspendida, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  async reactivar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.reactivada, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Registra consumo SIMULADO (lo invoca el planificador al ejecutar de forma simulada). */
  async registrarConsumoSimulado(ctx: RequestContext, capacidadId: string, monto: number, a: Attribution, o: string): Promise<void> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.consumoSimulado, { monto }, a, o);
  }

  /** Lista las capacidades con autorización registrada en la organización. */
  async listar(ctx: RequestContext): Promise<readonly string[]> {
    const eventos = await this.store.readStream(ctx, indiceStreamId(this.org(ctx)));
    const set = new Set<string>();
    for (const e of eventos) if (e.type === EVENTOS_INDICE.registrada) set.add((e.payload as { capacidadId: string }).capacidadId);
    return [...set];
  }

  private async asegurarEnIndice(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const ids = await this.listar(ctx);
    if (ids.includes(capacidadId)) return;
    const eventos: readonly RecordedEvent[] = await this.store.readStream(ctx, indiceStreamId(org));
    const input: EventInput = { type: EVENTOS_INDICE.registrada, payload: { capacidadId }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, indiceStreamId(org), eventos.length, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }
}
