/**
 * @soec/estrategia-creativa · aplicación · Servicio del calendario editorial (Tramo 5). Event-sourced,
 * multi-tenant. Garantiza: no programar contenido no aprobado (transiciones gobernadas), sin solapes
 * de canal en el mismo instante, reprogramación trazable, historial conservado. Nada real.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { EstrategiaCreativaInvalidaError } from '../domain/errors';
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
  constructor(private readonly store: EventStore) {}

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

  /** Agrega una entrada en estado BORRADOR (aún no programada). No se admiten fechas inválidas. */
  async agregarEntrada(ctx: RequestContext, programaId: string, e: EntradaNuevaCalendario, a: Attribution, o: string): Promise<CalendarioState> {
    if (!e.entradaId?.trim() || !e.canal?.trim() || !e.piezaId?.trim()) throw new EstrategiaCreativaInvalidaError('entradaId, canal y piezaId son obligatorios');
    if (!Number.isFinite(Date.parse(e.fechaHora))) throw new EstrategiaCreativaInvalidaError('fechaHora inválida');
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

  /** Transición gobernada. Al PROGRAMAR (PROGRAMADA_SIMULADA) exige estar APROBADA y sin solape. */
  async transicionar(ctx: RequestContext, programaId: string, entradaId: string, estado: EstadoEntrada, a: Attribution, o: string): Promise<CalendarioState> {
    const st = await this.cargar(ctx, programaId);
    const ent = st.entradas.find((x) => x.entradaId === entradaId);
    if (!ent) throw new EstrategiaCreativaInvalidaError(`entrada ${entradaId} no encontrada`);
    if (!transicionCalValida(ent.estado, estado)) throw new EstrategiaCreativaInvalidaError(`transición inválida ${ent.estado}→${estado} (no se programa contenido no aprobado)`);
    if (estado === 'PROGRAMADA_SIMULADA' && haySolape(st.entradas, ent.canal, ent.fechaHora, entradaId)) {
      throw new EstrategiaCreativaInvalidaError('solape: ya hay una pieza programada en ese canal e instante');
    }
    await this.append(ctx, programaId, st.version, EVENTOS_CAL.transicion, { entradaId, estado }, a, o);
    return this.cargar(ctx, programaId);
  }

  /** Reprogramación trazable: vuelve la entrada a APROBADA con nueva fecha (historial conservado). */
  async reprogramar(ctx: RequestContext, programaId: string, entradaId: string, nuevaFechaHora: string, a: Attribution, o: string): Promise<CalendarioState> {
    if (!Number.isFinite(Date.parse(nuevaFechaHora))) throw new EstrategiaCreativaInvalidaError('fechaHora inválida');
    const st = await this.cargar(ctx, programaId);
    const ent = st.entradas.find((x) => x.entradaId === entradaId);
    if (!ent) throw new EstrategiaCreativaInvalidaError(`entrada ${entradaId} no encontrada`);
    await this.append(ctx, programaId, st.version, EVENTOS_CAL.transicion, { entradaId, estado: 'APROBADA', fechaHora: nuevaFechaHora }, a, o);
    return this.cargar(ctx, programaId);
  }
}
