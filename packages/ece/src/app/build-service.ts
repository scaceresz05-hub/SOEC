/**
 * Servicio de construcción del ECE.
 *
 * Consume MED y MDM (a sus cortes), produce una representación DERIVADA,
 * determinística, idempotente y reproducible, y la persiste como eventos.
 * No decide, no recomienda, no invoca IA, no modifica MED ni MDM (§16).
 * La estrategia de construcción es Nivel B/C; la anatomía del ECE es Nivel A.
 */
import type { AppendResult, Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { MedService, MdmService, ModelInstanceState, Vigencia } from '@soec/models';
import {
  type CorteModelo,
  type ElementoEce,
  type EstadoSatisfaccion,
  type RefModelo,
  type TipoElemento,
  EVENTOS_ECE,
  eceStreamId,
  eventoDeRegistro,
  reconstruirEce,
} from '../domain/ece';
import { derivarElementos } from '../domain/derive';
import { ComandoEceInvalidoError, EceNotFoundError, ElementoInexistenteError } from '../domain/errors';

export interface ConstruirCmd {
  readonly eceId: string;
  readonly medInstanceId: string;
  readonly mdmInstanceId: string;
  /** Corte de conocimiento del MED; ausente = estado actual. */
  readonly corteMedRecordedAt?: string;
  readonly corteMdmRecordedAt?: string;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
}

export interface RegistrarElementoCmd {
  readonly eceId: string;
  readonly tipo: TipoElemento;
  readonly id: string;
  readonly referencias: readonly RefModelo[];
  readonly procedencia: string;
  readonly evidencia?: readonly string[];
  readonly alcance: string;
  readonly vigencia?: Vigencia | null;
  readonly incertidumbre: string;
  readonly limitaciones?: readonly string[];
  readonly noEvaluable?: boolean;
  readonly estadoSatisfaccion?: EstadoSatisfaccion | null;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
}

export class EceBuildService {
  constructor(
    private readonly store: EventStore,
    private readonly med: MedService,
    private readonly mdm: MdmService,
  ) {}

  private async cargar(ctx: RequestContext, eceId: string) {
    const events = await this.store.readStream(ctx, eceStreamId(eceId));
    return reconstruirEce(eceId, ctx.organizationId, events);
  }

  private append(ctx: RequestContext, eceId: string, version: number, input: EventInput): Promise<AppendResult> {
    return this.store.append(ctx, eceStreamId(eceId), version, [input]);
  }

  private corte(state: ModelInstanceState, recordedAt: string | undefined): CorteModelo {
    return { instanceId: state.instanceId, version: state.version, recordedAt: recordedAt ?? null };
  }

  /** Construye (o reconstruye) el ECE integrando MED y MDM a sus cortes. */
  async construir(ctx: RequestContext, c: ConstruirCmd): Promise<AppendResult> {
    const medState = c.corteMedRecordedAt
      ? await this.med.estadoHistorico(ctx, c.medInstanceId, c.corteMedRecordedAt)
      : await this.med.estadoActual(ctx, c.medInstanceId);
    const mdmState = c.corteMdmRecordedAt
      ? await this.mdm.estadoHistorico(ctx, c.mdmInstanceId, c.corteMdmRecordedAt)
      : await this.mdm.estadoActual(ctx, c.mdmInstanceId);

    if (!medState.existe || !mdmState.existe) {
      throw new ComandoEceInvalidoError('El ECE deriva de un MED y un MDM existentes');
    }

    const derivados: ElementoEce[] = derivarElementos(medState, mdmState);
    const estado = await this.cargar(ctx, c.eceId);
    const tipoEvento = estado.existe ? EVENTOS_ECE.reconstruido : EVENTOS_ECE.construido;
    const input: EventInput = {
      type: tipoEvento,
      payload: {
        medCorte: this.corte(medState, c.corteMedRecordedAt),
        mdmCorte: this.corte(mdmState, c.corteMdmRecordedAt),
        derivados,
      },
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return this.append(
      ctx,
      c.eceId,
      estado.version,
      c.idempotencyKey ? { ...input, idempotencyKey: c.idempotencyKey } : input,
    );
  }

  /** Registra un elemento DECLARADO (p. ej. una relación MED↔MDM), atribuido. */
  async registrarElemento(ctx: RequestContext, c: RegistrarElementoCmd): Promise<AppendResult> {
    if (c.referencias.length === 0) {
      throw new ComandoEceInvalidoError('Un elemento del ECE debe referenciar representaciones fuente');
    }
    const estado = await this.cargar(ctx, c.eceId);
    if (!estado.existe) throw new EceNotFoundError(`El ECE '${c.eceId}' no existe`);
    const elemento: ElementoEce = {
      id: c.id,
      tipo: c.tipo,
      origen: 'registrado',
      referencias: c.referencias,
      procedencia: c.procedencia,
      evidencia: c.evidencia ?? [],
      alcance: c.alcance,
      vigencia: c.vigencia ?? null,
      atribucion: c.attribution,
      incertidumbre: c.incertidumbre,
      limitaciones: c.limitaciones ?? [],
      estadoRevision: 'vigente',
      noEvaluable: c.noEvaluable ?? false,
      estadoSatisfaccion: c.estadoSatisfaccion ?? null,
      historial: [],
    };
    const input: EventInput = {
      type: eventoDeRegistro(c.tipo),
      payload: { elemento },
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return this.append(
      ctx,
      c.eceId,
      estado.version,
      c.idempotencyKey ? { ...input, idempotencyKey: c.idempotencyKey } : input,
    );
  }

  /** Revisa un elemento (p. ej. una dependencia insatisfecha → satisfecha), conservando historia. */
  async revisarElemento(
    ctx: RequestContext,
    c: {
      eceId: string;
      elementoId: string;
      estadoRevision: 'vigente' | 'revisado' | 'superado';
      motivo: string;
      estadoSatisfaccion?: EstadoSatisfaccion | null;
      attribution: Attribution;
      occurredAt: string;
    },
  ): Promise<AppendResult> {
    const estado = await this.cargar(ctx, c.eceId);
    if (!estado.existe) throw new EceNotFoundError(`El ECE '${c.eceId}' no existe`);
    if (!estado.elementos[c.elementoId]) {
      throw new ElementoInexistenteError(`El elemento '${c.elementoId}' no existe en el ECE`);
    }
    if (!c.motivo) throw new ComandoEceInvalidoError('La revisión exige motivo explícito');
    const payload: Record<string, unknown> = {
      elementoId: c.elementoId,
      estadoRevision: c.estadoRevision,
      motivo: c.motivo,
    };
    if (c.estadoSatisfaccion !== undefined) payload['estadoSatisfaccion'] = c.estadoSatisfaccion;
    return this.append(ctx, c.eceId, estado.version, {
      type: EVENTOS_ECE.revisado,
      payload,
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    });
  }

  /** Marca el ECE como desactualizado (requiere reconstrucción), sin sobrescribir la historia. */
  async invalidar(
    ctx: RequestContext,
    c: { eceId: string; motivo: string; causationId?: string; attribution: Attribution; occurredAt: string },
  ): Promise<AppendResult> {
    const estado = await this.cargar(ctx, c.eceId);
    if (!estado.existe) throw new EceNotFoundError(`El ECE '${c.eceId}' no existe`);
    const input: EventInput = {
      type: EVENTOS_ECE.invalidado,
      payload: { motivo: c.motivo },
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return this.append(
      ctx,
      c.eceId,
      estado.version,
      c.causationId ? { ...input, causationId: c.causationId } : input,
    );
  }
}
