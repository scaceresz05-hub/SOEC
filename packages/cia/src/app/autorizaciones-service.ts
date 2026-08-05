/**
 * @soec/cia · app · SERVICIO DE AUTORIZACIONES (ciclo de vida completo).
 *
 * El usuario autoriza CAPACIDADES (resultados) con CONDICIONES (límite, autonomía, período, alcance, riesgo).
 * Nunca herramientas; no hay proveedor en el dominio. Ciclo de vida gobernado, event-sourced, idempotente y
 * multi-tenant. Una modificación MATERIAL invalida la aprobación anterior (vuelve a PENDIENTE): nada hereda
 * aprobación en silencio. Estados terminales (REVOCADA/EXPIRADA/REEMPLAZADA/ELIMINADA) no admiten cambios.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { buscarCapacidad } from '../dominio/catalogo';
import {
  EVENTOS_AUTORIZACION, autorizacionStreamId, reconstruirAutorizacion, esCambioMaterial, CONDICIONES_POR_DEFECTO,
  type AutorizacionState, type CondicionesAutorizacion, type NivelAutonomia,
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
    if (st.terminada) throw new ComandoCiaInvalidoError(`la autorización está ${st.estado} (terminal); no admite cambios`);
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, autorizacionStreamId(this.org(ctx), capacidadId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  private exigirCapacidad(capacidadId: string): void {
    if (!buscarCapacidad(capacidadId)) throw new CapacidadDesconocidaError(`Capacidad de marketing desconocida: ${capacidadId}`);
  }

  /** Crea la autorización en BORRADOR y la registra en el índice. Idempotente. (Alias histórico: `solicitar`.) */
  async crear(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    this.exigirCapacidad(capacidadId);
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.creada, {}, a, o);
    await this.asegurarEnIndice(ctx, capacidadId, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Alias histórico de `crear` (solicitar la capacidad = registrarla en BORRADOR). */
  solicitar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    return this.crear(ctx, capacidadId, a, o);
  }

  /** Solicita aprobación con condiciones concretas → PENDIENTE. */
  async solicitarAprobacion(ctx: RequestContext, capacidadId: string, condiciones: CondicionesAutorizacion, a: Attribution, o: string): Promise<AutorizacionState> {
    this.exigirCapacidad(capacidadId);
    if (condiciones.limite < 0) throw new ComandoCiaInvalidoError('El límite no puede ser negativo.');
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.creada, {}, a, o);
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.aprobacionSolicitada, { condiciones }, a, o);
    await this.asegurarEnIndice(ctx, capacidadId, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Acto HUMANO: aprueba las condiciones pendientes → AUTORIZADA. */
  async aprobar(ctx: RequestContext, capacidadId: string, actorHumano: string, a: Attribution, o: string): Promise<AutorizacionState> {
    if (!actorHumano?.trim()) throw new ComandoCiaInvalidoError('Aprobar una autorización exige un actor humano (no puede autoaprobarse).');
    const st = await this.cargar(ctx, capacidadId);
    if (st.estado !== 'PENDIENTE') throw new ComandoCiaInvalidoError(`sólo se aprueba desde PENDIENTE (está ${st.estado})`);
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.autorizada, { actorHumano }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Conveniencia: solicita aprobación con condiciones y la aprueba (acto humano). */
  async autorizar(ctx: RequestContext, capacidadId: string, opts: { limite: number; nivelAutonomia: NivelAutonomia; actorHumano: string; periodo?: string; alcance?: string; riesgo?: CondicionesAutorizacion['riesgo'] }, a: Attribution, o: string): Promise<AutorizacionState> {
    if (!opts.actorHumano?.trim()) throw new ComandoCiaInvalidoError('Autorizar una capacidad exige un actor humano (no puede autoautorizarse).');
    const condiciones: CondicionesAutorizacion = {
      limite: opts.limite, nivelAutonomia: opts.nivelAutonomia,
      periodo: opts.periodo ?? CONDICIONES_POR_DEFECTO.periodo,
      alcance: opts.alcance ?? CONDICIONES_POR_DEFECTO.alcance,
      riesgo: opts.riesgo ?? CONDICIONES_POR_DEFECTO.riesgo,
    };
    await this.solicitarAprobacion(ctx, capacidadId, condiciones, a, o);
    return this.aprobar(ctx, capacidadId, opts.actorHumano, a, o);
  }

  /** Modifica condiciones. Si el cambio es MATERIAL, invalida la aprobación (→ PENDIENTE). */
  async modificar(ctx: RequestContext, capacidadId: string, cambios: Partial<CondicionesAutorizacion>, a: Attribution, o: string): Promise<AutorizacionState> {
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) throw new ComandoCiaInvalidoError('no existe la autorización');
    const base = st.aprobadas ?? st.condiciones;
    const nuevas: CondicionesAutorizacion = { ...base, ...cambios };
    if (nuevas.limite < 0) throw new ComandoCiaInvalidoError('El límite no puede ser negativo.');
    if (!esCambioMaterial(nuevas, base)) return st; // no-op
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.modificada, { condiciones: nuevas }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Ajusta sólo el límite (cambio material → requiere nueva aprobación). */
  fijarLimite(ctx: RequestContext, capacidadId: string, limite: number, a: Attribution, o: string): Promise<AutorizacionState> {
    return this.modificar(ctx, capacidadId, { limite }, a, o);
  }

  async pausar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.pausada, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  async reanudar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    const st = await this.cargar(ctx, capacidadId);
    if (st.estado !== 'PAUSADA') throw new ComandoCiaInvalidoError(`sólo se reanuda desde PAUSADA (está ${st.estado})`);
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.reanudada, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Alias histórico de `pausar` (suspender la capacidad). */
  suspender(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> { return this.pausar(ctx, capacidadId, a, o); }
  /** Alias histórico de `reanudar`. */
  reactivar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> { return this.reanudar(ctx, capacidadId, a, o); }

  async revocar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.revocada, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  async expirar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.expirada, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  async reemplazar(ctx: RequestContext, capacidadId: string, porAutorizacionId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.reemplazada, { porAutorizacionId }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  async eliminar(ctx: RequestContext, capacidadId: string, a: Attribution, o: string): Promise<AutorizacionState> {
    await this.append(ctx, capacidadId, EVENTOS_AUTORIZACION.eliminada, {}, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Registra consumo SIMULADO (lo invoca el planificador al ejecutar). Permitido aun si no está AUTORIZADA. */
  async registrarConsumoSimulado(ctx: RequestContext, capacidadId: string, monto: number, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, capacidadId);
    if (st.terminada) return;
    const input: EventInput = { type: EVENTOS_AUTORIZACION.consumoSimulado, payload: { monto }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, autorizacionStreamId(this.org(ctx), capacidadId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
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
