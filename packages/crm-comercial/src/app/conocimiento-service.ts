/**
 * @soec/crm-comercial · aplicación · Servicio de CONOCIMIENTO COMERCIAL tipado.
 *
 * Frontera SSOT (H-3): `@soec/negocio` es el almacén CANÓNICO de la EXISTENCIA de una entidad
 * comercial (empresa/producto/servicio/ICP/competidor/mercado) y de su evidencia; este servicio es
 * la capa TIPADA/operacional que valida el esquema por tipo, guarda la procedencia POR CAMPO y
 * calcula la cobertura, referenciando la entidad canónica por el MISMO id. No es una segunda base
 * independiente: al registrar una entidad, se asegura (idempotente) su ítem canónico en `@soec/negocio`.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { ConocimientoService as NegocioConocimientoService, type TipoEntidad, type TipoEvidencia } from '@soec/negocio';
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
import { LIMITES, normalizarOpcional, validarTexto } from '../domain/validacion';

/** Mapa TipoPerfil → TipoEntidad canónica de `@soec/negocio` (SSOT de existencia). */
const MAPA_TIPO: Record<TipoPerfil, TipoEntidad> = {
  EMPRESA: 'ORGANIZACION',
  PRODUCTO: 'PRODUCTO',
  SERVICIO: 'PRODUCTO',
  CLIENTE_IDEAL: 'PUBLICO',
  COMPETIDOR: 'COMPETIDOR',
  MERCADO: 'MERCADO',
};

export class ConocimientoComercialService {
  private readonly negocio: NegocioConocimientoService;
  constructor(private readonly store: EventStore, negocio?: NegocioConocimientoService) {
    this.negocio = negocio ?? new NegocioConocimientoService(store);
  }

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

  /**
   * Registra una entidad comercial (idempotente por id) y ASEGURA su ítem canónico en `@soec/negocio`
   * (SSOT de existencia). El `id` de la entidad crm ES el `itemId` canónico en negocio.
   */
  async registrarEntidad(ctx: RequestContext, id: string, tipo: TipoPerfil, nombre: string, a: Attribution, occurredAt: string): Promise<void> {
    if (!id?.trim() || !nombre?.trim()) throw new ComandoCrmInvalidoError('id y nombre son obligatorios');
    const nombreOk = validarTexto(nombre.trim(), LIMITES.nombre, 'nombre');
    const state = await this.cargar(ctx);
    if (!this.entidad(state, id)) {
      await this.append(ctx, state.version, EVENTOS_PERFIL.registrada, { id, tipo, nombre: nombreOk }, a, occurredAt);
    }
    // H-3: asegurar la entidad canónica en @soec/negocio, idempotente y autorreparable.
    const neg = await this.negocio.cargar(ctx);
    if (!neg.items[id]) {
      await this.negocio.registrar(ctx, { itemId: id, organizacionId: this.org(ctx), tipo: MAPA_TIPO[tipo], nombre: nombreOk, origen: 'DATO_DECLARADO_POR_USUARIO' }, a, occurredAt);
    }
  }

  /** Establece/actualiza un campo del esquema del tipo, con su origen epistémico. H-5: valida. */
  async establecerCampo(ctx: RequestContext, id: string, clave: string, valor: string, origen: TipoEvidencia, a: Attribution, occurredAt: string, fuente: string | null = null): Promise<void> {
    const state = await this.cargar(ctx);
    const ent = this.entidad(state, id);
    if (!ent) throw new ComandoCrmInvalidoError(`entidad ${id} no registrada`);
    if (!claveValida(ent.tipo, clave)) throw new ComandoCrmInvalidoError(`campo '${clave}' no pertenece al esquema de ${ent.tipo}`);
    validarTexto(valor ?? '', LIMITES.valorAtributo, `valor de '${clave}'`);
    const fuenteOk = normalizarOpcional(fuente, LIMITES.texto, 'fuente');
    await this.append(ctx, state.version, EVENTOS_PERFIL.campo, { id, clave, campo: campo(valor, origen, fuenteOk) }, a, occurredAt);
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
