/**
 * Servicio del conocimiento de negocio. Toda lectura/escritura está ACOTADA por la
 * organización del contexto (`negocio:<org>`): una organización nunca ve ni escribe el
 * conocimiento de otra (aislamiento multiempresa por diseño + guarda explícita). La
 * confianza se deriva del origen cuando el comando no la fija, y se anula donde no tiene
 * significado (hipótesis/simulación/desconocido).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type Confianza,
  type ConocimientoState,
  type ItemConocimiento,
  type TipoEntidad,
  type TipoEvidencia,
  EVENTOS_CONOCIMIENTO,
  confianzaPorDefecto,
  negocioStreamId,
  reconstruirConocimiento,
} from '../domain/conocimiento';
import { ConocimientoInvalidoError, SeparacionVioladaError } from '../domain/errors';

export interface ComandoRegistrar {
  readonly itemId: string;
  readonly organizacionId: string;
  readonly tipo: TipoEntidad;
  readonly nombre: string;
  readonly atributos?: Record<string, string>;
  readonly origen: TipoEvidencia;
  readonly fuente?: string | null;
  /** Confianza explícita; si se omite se deriva del origen (donde tenga significado). */
  readonly confianza?: Confianza;
}

export class ConocimientoService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private exigirMismaOrg(ctx: RequestContext, organizacionId: string): void {
    if (organizacionId !== this.org(ctx)) {
      throw new SeparacionVioladaError(
        `El conocimiento pertenece a otra organización (${organizacionId} ≠ ${this.org(ctx)}); separación multiempresa violada.`,
      );
    }
  }

  cargar(ctx: RequestContext): Promise<ConocimientoState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, negocioStreamId(org)).then((e) => reconstruirConocimiento(org, e));
  }

  async listar(ctx: RequestContext, tipo?: TipoEntidad): Promise<ItemConocimiento[]> {
    const st = await this.cargar(ctx);
    const items = Object.values(st.items);
    return tipo ? items.filter((i) => i.tipo === tipo) : items;
  }

  async registrar(ctx: RequestContext, cmd: ComandoRegistrar, a: Attribution, o: string): Promise<ConocimientoState> {
    if (!cmd.itemId.trim()) throw new ConocimientoInvalidoError('itemId requerido');
    if (!cmd.nombre.trim()) throw new ConocimientoInvalidoError('nombre requerido');
    this.exigirMismaOrg(ctx, cmd.organizacionId);
    const confianza = cmd.confianza !== undefined ? cmd.confianza : confianzaPorDefecto(cmd.origen);
    const estado = await this.cargar(ctx);
    const input: EventInput = {
      type: EVENTOS_CONOCIMIENTO.registrado,
      payload: {
        itemId: cmd.itemId,
        tipo: cmd.tipo,
        nombre: cmd.nombre,
        atributos: cmd.atributos ?? {},
        origen: cmd.origen,
        fuente: cmd.fuente ?? null,
        confianza,
      },
      attribution: a,
      occurredAt: o,
    };
    await this.store.append(ctx, negocioStreamId(this.org(ctx)), estado.version, [input]);
    return this.cargar(ctx);
  }

  async registrarFaltante(ctx: RequestContext, faltanteId: string, sobre: string, motivo: string, a: Attribution, o: string): Promise<ConocimientoState> {
    const estado = await this.cargar(ctx);
    const input: EventInput = {
      type: EVENTOS_CONOCIMIENTO.faltante,
      payload: { faltanteId, sobre, motivo },
      attribution: a,
      occurredAt: o,
    };
    await this.store.append(ctx, negocioStreamId(this.org(ctx)), estado.version, [input]);
    return this.cargar(ctx);
  }
}
