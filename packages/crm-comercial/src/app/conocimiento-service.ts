/**
 * @soec/crm-comercial · aplicación · Servicio de CONOCIMIENTO COMERCIAL tipado.
 *
 * Comandos y consultas sobre los perfiles comerciales (empresa, productos, servicios, ICP,
 * competidores, mercado), event-sourced en el stream `conocimiento-comercial:<org>` y acotados por
 * organización. Valida que cada campo pertenezca al ESQUEMA del tipo (conocimiento estructurado, no
 * un saco de atributos libres) y preserva la procedencia epistémica de cada dato.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { TipoEvidencia } from '@soec/negocio';
import { ComandoCrmInvalidoError } from '../domain/errors';
import {
  type Cobertura,
  type ConocimientoComercialState,
  type EntidadComercial,
  EVENTOS_PERFIL,
  type TipoPerfil,
  campo,
  claveValida,
  coberturaDe,
  conocimientoComercialStreamId,
  reconstruirConocimientoComercial,
} from '../domain/perfiles';

export class ConocimientoComercialService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext): Promise<ConocimientoComercialState> {
    const org = this.org(ctx);
    return reconstruirConocimientoComercial(org, await this.store.readStream(ctx, conocimientoComercialStreamId(org)));
  }

  private async append(ctx: RequestContext, version: number, type: string, payload: unknown, a: Attribution, occurredAt: string): Promise<void> {
    const input: EventInput = { type, payload, attribution: a, occurredAt };
    await this.store.append(ctx, conocimientoComercialStreamId(this.org(ctx)), version, [input]);
  }

  private entidad(state: ConocimientoComercialState, id: string): EntidadComercial | null {
    return id === 'empresa' ? state.empresa : (state.entidades[id] ?? null);
  }

  /** Registra una entidad comercial (idempotente por id). Empresa = id 'empresa', tipo 'EMPRESA'. */
  async registrarEntidad(ctx: RequestContext, id: string, tipo: TipoPerfil, nombre: string, a: Attribution, occurredAt: string): Promise<void> {
    if (!id?.trim() || !nombre?.trim()) throw new ComandoCrmInvalidoError('id y nombre son obligatorios');
    const state = await this.cargar(ctx);
    if (this.entidad(state, id)) return; // idempotente
    await this.append(ctx, state.version, EVENTOS_PERFIL.registrada, { id, tipo, nombre: nombre.trim() }, a, occurredAt);
  }

  /** Establece/actualiza un campo del esquema del tipo, con su origen epistémico. */
  async establecerCampo(ctx: RequestContext, id: string, clave: string, valor: string, origen: TipoEvidencia, a: Attribution, occurredAt: string, fuente: string | null = null): Promise<void> {
    const state = await this.cargar(ctx);
    const ent = this.entidad(state, id);
    if (!ent) throw new ComandoCrmInvalidoError(`entidad ${id} no registrada`);
    if (!claveValida(ent.tipo, clave)) throw new ComandoCrmInvalidoError(`campo '${clave}' no pertenece al esquema de ${ent.tipo}`);
    await this.append(ctx, state.version, EVENTOS_PERFIL.campo, { id, clave, campo: campo(valor, origen, fuente) }, a, occurredAt);
  }

  /** Declara información faltante sobre una entidad (Evaluabilidad: la ausencia se registra). */
  async declararFaltante(ctx: RequestContext, id: string, sobre: string, motivo: string, a: Attribution, occurredAt: string): Promise<void> {
    const state = await this.cargar(ctx);
    if (!this.entidad(state, id)) throw new ComandoCrmInvalidoError(`entidad ${id} no registrada`);
    await this.append(ctx, state.version, EVENTOS_PERFIL.faltante, { id, sobre, motivo }, a, occurredAt);
  }

  /** Cobertura del conocimiento de una entidad (qué se sabe vs qué falta del esquema). */
  async cobertura(ctx: RequestContext, id: string): Promise<Cobertura> {
    const ent = this.entidad(await this.cargar(ctx), id);
    if (!ent) throw new ComandoCrmInvalidoError(`entidad ${id} no registrada`);
    return coberturaDe(ent);
  }

  /** Lista las entidades de un tipo (incluye la empresa cuando tipo === 'EMPRESA'). */
  async listarPorTipo(ctx: RequestContext, tipo: TipoPerfil): Promise<readonly EntidadComercial[]> {
    const state = await this.cargar(ctx);
    const base = Object.values(state.entidades).filter((e) => e.tipo === tipo);
    return tipo === 'EMPRESA' && state.empresa ? [state.empresa, ...base] : base;
  }
}
