/**
 * Relación explícita entre una representación del MED y una del MDM (#11 §4).
 *
 * Las representaciones quedan **enlazadas pero no fusionadas** (No Confusión):
 * el enlace vive en su propio agregado, conserva origen, naturaleza, organización,
 * atribución, vigencia, incertidumbre e historial, y jamás mezcla los estados de
 * ambos modelos. No decide ni integra (eso es el ECE, #12).
 */
import type { AppendResult, Attribution, EventInput, EventStore, RecordedEvent, RequestContext } from '@soec/contracts';
import type { Vigencia } from '../domain/model';
import { ComandoInvalidoError, ModelAlreadyExistsError, ModelNotFoundError } from '../domain/errors';

export const EVENTOS_LINK = {
  registrada: 'rel.med_mdm_registrada',
  revisada: 'rel.med_mdm_revisada',
} as const;

function linkStreamId(linkId: string): string {
  return `link:${linkId}`;
}

interface CambioEnlace {
  readonly naturaleza: string;
  readonly vigencia: Vigencia;
  readonly incertidumbre: string;
  readonly motivo: string;
  readonly registradoEn: string;
}

export interface LinkState {
  readonly linkId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  /** Origen y destino del enlace, referenciados sin fusionar (No Confusión). */
  readonly medRef: string | null;
  readonly mdmRef: string | null;
  readonly naturaleza: string;
  readonly vigencia: Vigencia | null;
  readonly incertidumbre: string;
  readonly atribucion: Attribution | null;
  readonly historial: readonly CambioEnlace[];
}

interface PayloadRegistrada {
  medRef: string;
  mdmRef: string;
  naturaleza: string;
  vigencia: Vigencia;
  incertidumbre: string;
}
interface PayloadRevisada {
  naturaleza?: string;
  vigencia?: Vigencia;
  incertidumbre?: string;
  motivo: string;
}

function estadoInicialLink(linkId: string, organizationId: string): LinkState {
  return {
    linkId,
    organizationId,
    version: 0,
    existe: false,
    medRef: null,
    mdmRef: null,
    naturaleza: '',
    vigencia: null,
    incertidumbre: '',
    atribucion: null,
    historial: [],
  };
}

function aplicarLink(state: LinkState, event: RecordedEvent): LinkState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_LINK.registrada) {
    const p = event.payload as PayloadRegistrada;
    return {
      ...next,
      existe: true,
      medRef: p.medRef,
      mdmRef: p.mdmRef,
      naturaleza: p.naturaleza,
      vigencia: p.vigencia,
      incertidumbre: p.incertidumbre,
      atribucion: event.attribution,
      historial: [
        {
          naturaleza: p.naturaleza,
          vigencia: p.vigencia,
          incertidumbre: p.incertidumbre,
          motivo: 'registro',
          registradoEn: event.recordedAt,
        },
      ],
    };
  }
  if (event.type === EVENTOS_LINK.revisada) {
    const p = event.payload as PayloadRevisada;
    const naturaleza = p.naturaleza ?? state.naturaleza;
    const vigencia = p.vigencia ?? state.vigencia;
    const incertidumbre = p.incertidumbre ?? state.incertidumbre;
    return {
      ...next,
      naturaleza,
      vigencia,
      incertidumbre,
      historial: [
        ...state.historial,
        {
          naturaleza,
          vigencia: vigencia ?? { desde: event.recordedAt, hasta: null },
          incertidumbre,
          motivo: p.motivo,
          registradoEn: event.recordedAt,
        },
      ],
    };
  }
  return next;
}

export class ModelLinkService {
  constructor(private readonly store: EventStore) {}

  private async cargar(ctx: RequestContext, linkId: string): Promise<LinkState> {
    const events = await this.store.readStream(ctx, linkStreamId(linkId));
    return events.reduce(aplicarLink, estadoInicialLink(linkId, ctx.organizationId));
  }

  async registrar(
    ctx: RequestContext,
    c: {
      linkId: string;
      medRef: string;
      mdmRef: string;
      naturaleza: string;
      vigencia: Vigencia;
      incertidumbre: string;
      attribution: Attribution;
      occurredAt: string;
      idempotencyKey?: string;
    },
  ): Promise<AppendResult> {
    if (!c.medRef || !c.mdmRef) {
      throw new ComandoInvalidoError('Un enlace MED↔MDM exige referencias a ambas representaciones');
    }
    const estado = await this.cargar(ctx, c.linkId);
    if (estado.existe) throw new ModelAlreadyExistsError(`El enlace '${c.linkId}' ya existe`);
    const input: EventInput = {
      type: EVENTOS_LINK.registrada,
      payload: {
        medRef: c.medRef,
        mdmRef: c.mdmRef,
        naturaleza: c.naturaleza,
        vigencia: c.vigencia,
        incertidumbre: c.incertidumbre,
      },
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return this.store.append(ctx, linkStreamId(c.linkId), estado.version, [
      c.idempotencyKey ? { ...input, idempotencyKey: c.idempotencyKey } : input,
    ]);
  }

  async revisar(
    ctx: RequestContext,
    c: {
      linkId: string;
      naturaleza?: string;
      vigencia?: Vigencia;
      incertidumbre?: string;
      motivo: string;
      attribution: Attribution;
      occurredAt: string;
    },
  ): Promise<AppendResult> {
    const estado = await this.cargar(ctx, c.linkId);
    if (!estado.existe) throw new ModelNotFoundError(`El enlace '${c.linkId}' no existe`);
    if (!c.motivo) throw new ComandoInvalidoError('La revisión del enlace exige motivo');
    const payload: Record<string, unknown> = { motivo: c.motivo };
    if (c.naturaleza !== undefined) payload['naturaleza'] = c.naturaleza;
    if (c.vigencia !== undefined) payload['vigencia'] = c.vigencia;
    if (c.incertidumbre !== undefined) payload['incertidumbre'] = c.incertidumbre;
    return this.store.append(ctx, linkStreamId(c.linkId), estado.version, [
      { type: EVENTOS_LINK.revisada, payload, attribution: c.attribution, occurredAt: c.occurredAt },
    ]);
  }

  estado(ctx: RequestContext, linkId: string): Promise<LinkState> {
    return this.cargar(ctx, linkId);
  }
}
