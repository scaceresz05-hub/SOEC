/**
 * Puerto de lectura del ECE — frontera estable y de SOLO LECTURA para que la capa
 * posterior (Sistema de Operaciones Intelectuales, #13) consuma el estado cognitivo
 * sin conocer su persistencia. No expone tablas internas como contrato y no se
 * nombra según ninguna tecnología de IA. Aquí NO viven consumidores del #13.
 */
import type { RequestContext } from '@soec/contracts';
import type { EventStore } from '@soec/contracts';
import type { MedService, MdmService } from '@soec/models';
import {
  type CorteModelo,
  type EceState,
  type ElementoEce,
  eceStreamId,
  elementosPorTipo,
  reconstruirEce,
} from '../domain/ece';

export interface VigenciaEce {
  readonly vigente: boolean;
  readonly requiereReconstruccion: boolean;
  readonly medCorte: CorteModelo | null;
  readonly medVersionActual: number;
  readonly mdmCorte: CorteModelo | null;
  readonly mdmVersionActual: number;
}

export interface ProcedenciaEce {
  readonly medCorte: CorteModelo | null;
  readonly mdmCorte: CorteModelo | null;
  readonly construidoEn: string | null;
}

/** Contrato de lectura del ECE (lo que #13 podrá consumir). */
export interface EceReadPort {
  estadoActual(ctx: RequestContext, eceId: string): Promise<EceState>;
  estadoEnFecha(ctx: RequestContext, eceId: string, asOfRecordedAt: string): Promise<EceState>;
  coherencias(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]>;
  contradicciones(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]>;
  ausencias(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]>;
  dependencias(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]>;
  brechas(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]>;
  noEvaluables(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]>;
  procedencia(ctx: RequestContext, eceId: string): Promise<ProcedenciaEce>;
  evidencia(ctx: RequestContext, eceId: string): Promise<readonly string[]>;
  limitaciones(ctx: RequestContext, eceId: string): Promise<readonly string[]>;
  vigencia(ctx: RequestContext, eceId: string): Promise<VigenciaEce>;
}

export class EceQueryService implements EceReadPort {
  constructor(
    private readonly store: EventStore,
    private readonly med: MedService,
    private readonly mdm: MdmService,
  ) {}

  private async cargar(ctx: RequestContext, eceId: string): Promise<EceState> {
    const events = await this.store.readStream(ctx, eceStreamId(eceId));
    return reconstruirEce(eceId, ctx.organizationId, events);
  }

  async estadoActual(ctx: RequestContext, eceId: string): Promise<EceState> {
    return this.cargar(ctx, eceId);
  }

  async estadoEnFecha(ctx: RequestContext, eceId: string, asOfRecordedAt: string): Promise<EceState> {
    const events = await this.store.reconstructAt(ctx, eceStreamId(eceId), asOfRecordedAt);
    return reconstruirEce(eceId, ctx.organizationId, events);
  }

  async coherencias(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]> {
    return elementosPorTipo(await this.cargar(ctx, eceId), 'coherencia');
  }
  async contradicciones(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]> {
    return elementosPorTipo(await this.cargar(ctx, eceId), 'contradiccion');
  }
  async ausencias(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]> {
    return elementosPorTipo(await this.cargar(ctx, eceId), 'ausencia');
  }
  async dependencias(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]> {
    return elementosPorTipo(await this.cargar(ctx, eceId), 'dependencia');
  }
  async brechas(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]> {
    return elementosPorTipo(await this.cargar(ctx, eceId), 'brecha');
  }
  async noEvaluables(ctx: RequestContext, eceId: string): Promise<readonly ElementoEce[]> {
    const st = await this.cargar(ctx, eceId);
    return Object.values(st.elementos).filter((e) => e.noEvaluable);
  }

  async procedencia(ctx: RequestContext, eceId: string): Promise<ProcedenciaEce> {
    const st = await this.cargar(ctx, eceId);
    return { medCorte: st.medCorte, mdmCorte: st.mdmCorte, construidoEn: st.construidoEn };
  }

  async evidencia(ctx: RequestContext, eceId: string): Promise<readonly string[]> {
    const st = await this.cargar(ctx, eceId);
    const set = new Set<string>();
    for (const el of Object.values(st.elementos)) for (const ev of el.evidencia) set.add(ev);
    return [...set];
  }

  async limitaciones(ctx: RequestContext, eceId: string): Promise<readonly string[]> {
    const st = await this.cargar(ctx, eceId);
    const set = new Set<string>();
    for (const el of Object.values(st.elementos)) for (const l of el.limitaciones) set.add(l);
    return [...set];
  }

  /** Determina si el ECE sigue vigente comparando sus cortes con la versión actual de MED y MDM. */
  async vigencia(ctx: RequestContext, eceId: string): Promise<VigenciaEce> {
    const st = await this.cargar(ctx, eceId);
    const medActual = st.medCorte ? await this.med.estadoActual(ctx, st.medCorte.instanceId) : null;
    const mdmActual = st.mdmCorte ? await this.mdm.estadoActual(ctx, st.mdmCorte.instanceId) : null;
    const medVersionActual = medActual?.version ?? 0;
    const mdmVersionActual = mdmActual?.version ?? 0;
    const desactualizado =
      st.requiereReconstruccion ||
      (st.medCorte ? medVersionActual > st.medCorte.version : false) ||
      (st.mdmCorte ? mdmVersionActual > st.mdmCorte.version : false);
    return {
      vigente: st.existe && st.vigente && !desactualizado,
      requiereReconstruccion: desactualizado,
      medCorte: st.medCorte,
      medVersionActual,
      mdmCorte: st.mdmCorte,
      mdmVersionActual,
    };
  }
}
