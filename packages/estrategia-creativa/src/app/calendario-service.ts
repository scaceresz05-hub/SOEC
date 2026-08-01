/**
 * @soec/estrategia-creativa · aplicación · Servicio del calendario editorial (Tramo 5). Event-sourced,
 * multi-tenant. Garantiza: no programar contenido no aprobado (transiciones gobernadas), sin solapes
 * de canal en el mismo instante, reprogramación trazable, historial conservado. Nada real.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { EstrategiaCreativaInvalidaError } from '../domain/errors';
import { AprobacionService } from './aprobacion-service';
import {
  type CalendarioState,
  EVENTOS_CAL,
  type EstadoEntrada,
  type EntradaCalendario,
  calendarioStreamId,
  haySolape,
  reconstruirCalendario,
  transicionCalValida,
} from '../domain/calendario';

export interface EntradaNuevaCalendario {
  readonly entradaId: string;
  readonly fechaHora: string;
  readonly canal: string;
  readonly piezaId: string;
  readonly varianteId?: string;
  readonly objetivo: string;
  readonly segmento: string;
}

export class CalendarioEditorialService {
  private readonly aprobacion: AprobacionService;
  constructor(private readonly store: EventStore, aprobacion?: AprobacionService) {
    this.aprobacion = aprobacion ?? new AprobacionService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, programaId: string): Promise<CalendarioState> {
    const org = this.org(ctx);
    return reconstruirCalendario(org, programaId, await this.store.readStream(ctx, calendarioStreamId(org, programaId)));
  }

  private append(ctx: RequestContext, programaId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<{ version: number }> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, calendarioStreamId(this.org(ctx), programaId), version, [input]);
  }

  async crear(ctx: RequestContext, programaId: string, zonaHoraria: string, a: Attribution, o: string): Promise<CalendarioState> {
    const st = await this.cargar(ctx, programaId);
    if (st.existe) return st;
    await this.append(ctx, programaId, st.version, EVENTOS_CAL.creado, { zonaHoraria: zonaHoraria || 'UTC' }, a, o);
    return this.cargar(ctx, programaId);
  }

  /**
   * Agrega una entrada en estado BORRADOR (aún no programada). No admite fechas inválidas ni (C-4) fechas
   * PASADAS respecto del instante del comando, salvo import histórico explícito (`opts.permitirHistorico`).
   */
  async agregarEntrada(ctx: RequestContext, programaId: string, e: EntradaNuevaCalendario, a: Attribution, o: string, opts?: { permitirHistorico?: boolean }): Promise<CalendarioState> {
    if (!e.entradaId?.trim() || !e.canal?.trim() || !e.piezaId?.trim()) throw new EstrategiaCreativaInvalidaError('entradaId, canal y piezaId son obligatorios');
    if (!Number.isFinite(Date.parse(e.fechaHora))) throw new EstrategiaCreativaInvalidaError('fechaHora inválida');
    if (!opts?.permitirHistorico && Number.isFinite(Date.parse(o)) && Date.parse(e.fechaHora) < Date.parse(o)) {
      throw new EstrategiaCreativaInvalidaError('fechaHora en el pasado: use import histórico explícito si es intencional');
    }
    const st = await this.cargar(ctx, programaId);
    if (!st.existe) throw new EstrategiaCreativaInvalidaError('el calendario no existe (crear primero)');
    if (st.entradas.some((x) => x.entradaId === e.entradaId)) return st; // idempotente
    const entrada: EntradaCalendario = {
      entradaId: e.entradaId,
      fechaHora: e.fechaHora,
      canal: e.canal,
      piezaId: e.piezaId,
      varianteId: e.varianteId ?? null,
      objetivo: e.objetivo,
      segmento: e.segmento,
      estado: 'BORRADOR',
      naturaleza: 'SIMULADO',
    };
    await this.append(ctx, programaId, st.version, EVENTOS_CAL.entrada, entrada, a, o);
    return this.cargar(ctx, programaId);
  }

  /**
   * Transición gobernada. Al PROGRAMAR (PROGRAMADA_SIMULADA) exige: transición válida, sin solape, y
   * (B-4) que la PIEZA de la entrada esté APROBADA en el gate CANÓNICO (`AprobacionService`) — no basta
   * el estado interno de la entrada. Además, si se aprueba una VARIANTE de la entrada, también se exige.
   */
  async transicionar(ctx: RequestContext, programaId: string, entradaId: string, estado: EstadoEntrada, a: Attribution, o: string): Promise<CalendarioState> {
    const st = await this.cargar(ctx, programaId);
    const ent = st.entradas.find((x) => x.entradaId === entradaId);
    if (!ent) throw new EstrategiaCreativaInvalidaError(`entrada ${entradaId} no encontrada`);
    if (!transicionCalValida(ent.estado, estado)) throw new EstrategiaCreativaInvalidaError(`transición inválida ${ent.estado}→${estado}`);
    if (estado === 'PROGRAMADA_SIMULADA') {
      if (!(await this.aprobacion.aprobadaVigente(ctx, 'PIEZA', ent.piezaId))) {
        throw new EstrategiaCreativaInvalidaError(`no se puede programar: la pieza ${ent.piezaId} no está aprobada en el gate canónico`);
      }
      if (ent.varianteId && !(await this.aprobacion.aprobadaVigente(ctx, 'VARIANTE', ent.varianteId))) {
        throw new EstrategiaCreativaInvalidaError(`no se puede programar: la variante ${ent.varianteId} no está aprobada`);
      }
      if (haySolape(st.entradas, ent.canal, ent.fechaHora, entradaId)) {
        throw new EstrategiaCreativaInvalidaError('solape: ya hay una pieza programada en ese canal e instante');
      }
    }
    await this.append(ctx, programaId, st.version, EVENTOS_CAL.transicion, { entradaId, estado }, a, o);
    return this.cargar(ctx, programaId);
  }

  /**
   * Reprogramación trazable: nueva fecha conservando historial. C-3: respeta la máquina de estados — no
   * resucita entradas TERMINALES (CANCELADA/PUBLICADA_SIMULADA). No admite fechas pasadas (C-4).
   */
  async reprogramar(ctx: RequestContext, programaId: string, entradaId: string, nuevaFechaHora: string, a: Attribution, o: string, opts?: { permitirHistorico?: boolean }): Promise<CalendarioState> {
    if (!Number.isFinite(Date.parse(nuevaFechaHora))) throw new EstrategiaCreativaInvalidaError('fechaHora inválida');
    if (!opts?.permitirHistorico && Number.isFinite(Date.parse(o)) && Date.parse(nuevaFechaHora) < Date.parse(o)) {
      throw new EstrategiaCreativaInvalidaError('fechaHora en el pasado: use import histórico explícito si es intencional');
    }
    const st = await this.cargar(ctx, programaId);
    const ent = st.entradas.find((x) => x.entradaId === entradaId);
    if (!ent) throw new EstrategiaCreativaInvalidaError(`entrada ${entradaId} no encontrada`);
    if (ent.estado === 'CANCELADA' || ent.estado === 'PUBLICADA_SIMULADA') {
      throw new EstrategiaCreativaInvalidaError(`no se puede reprogramar una entrada ${ent.estado} (estado terminal)`);
    }
    await this.append(ctx, programaId, st.version, EVENTOS_CAL.transicion, { entradaId, estado: 'APROBADA', fechaHora: nuevaFechaHora }, a, o);
    return this.cargar(ctx, programaId);
  }
}
