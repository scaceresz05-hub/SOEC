/**
 * Servicio de evaluación. Cada evaluación tiene identidad propia
 * (`Organización + Departamento + EvaluacionId`); dos sesiones nunca se mezclan. Inicia,
 * captura respuestas (normalizadas de forma segura, conservando la entrada original),
 * CONGELA generaciones de comprensión (con huella) y administra el ciclo BORRADOR →
 * GENERADA → CERRADA / ARCHIVADA (sin borrado ni reinicio destructivo). Mantiene un índice
 * de evaluaciones por (org, departamento) para poder listarlas. Todos los eventos llevan
 * `schemaVersion`. Concurrencia optimista vía `expectedVersion`. No ejecuta Diagnóstico/
 * Estrategia. El tiempo de ocurrencia se inyecta (reloj real en producción, fijo en tests).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type EntradaRespuesta,
  type EvaluacionState,
  type EstadoEvaluacion,
  type TipoPregunta,
  EVENTOS_EVAL,
  EVENTOS_INDICE,
  SCHEMA_VERSION_EVAL,
  aRespuestasDiagnostico,
  estadoDe,
  evalStreamId,
  huellaRespuestas,
  indiceStreamId,
  normalizarRespuesta,
  reconstruirEvaluacion,
  reconstruirIndice,
} from '../domain/evaluacion';
import { EvaluacionInvalidaError } from '../domain/errors';

export interface ComandoResponder {
  readonly preguntaId: string;
  readonly tipoPregunta: TipoPregunta;
  readonly entrada: EntradaRespuesta;
}

export interface ResumenEvaluacion {
  readonly evaluacionId: string;
  readonly titulo: string | null;
  readonly estado: EstadoEvaluacion;
  readonly creadaEn: string | null;
  readonly respondidas: number;
  readonly tieneGeneracion: boolean;
}

export class EvaluacionService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
  ): Promise<EvaluacionState> {
    const org = this.org(ctx);
    return this.store
      .readStream(ctx, evalStreamId(org, departamentoId, evaluacionId))
      .then((e) => reconstruirEvaluacion(org, departamentoId, evaluacionId, e));
  }

  private editable(st: EvaluacionState): void {
    if (st.archivada || st.cerrada) {
      throw new EvaluacionInvalidaError(
        'La evaluación está cerrada o archivada; no admite cambios.',
      );
    }
  }

  async iniciar(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
    rubroId: string,
    titulo: string | null,
    a: Attribution,
    o: string,
  ): Promise<EvaluacionState> {
    const org = this.org(ctx);
    const estado = await this.cargar(ctx, departamentoId, evaluacionId);
    if (estado.existe) return estado; // idempotente: no reinicia una evaluación en curso
    const payload = titulo
      ? { rubroId, titulo, schemaVersion: SCHEMA_VERSION_EVAL }
      : { rubroId, schemaVersion: SCHEMA_VERSION_EVAL };
    const input: EventInput = {
      type: EVENTOS_EVAL.iniciada,
      payload,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `init:${evalStreamId(org, departamentoId, evaluacionId)}`,
    };
    await this.store.append(ctx, evalStreamId(org, departamentoId, evaluacionId), estado.version, [
      input,
    ]);
    await this.registrarEnIndice(ctx, departamentoId, evaluacionId, titulo, a, o);
    return this.cargar(ctx, departamentoId, evaluacionId);
  }

  private async registrarEnIndice(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
    titulo: string | null,
    a: Attribution,
    o: string,
  ): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirIndice(
      org,
      departamentoId,
      await this.store.readStream(ctx, indiceStreamId(org, departamentoId)),
    );
    if (idx.evaluaciones.some((e) => e.evaluacionId === evaluacionId)) return;
    const payload = titulo
      ? { evaluacionId, titulo, schemaVersion: SCHEMA_VERSION_EVAL }
      : { evaluacionId, schemaVersion: SCHEMA_VERSION_EVAL };
    const input: EventInput = {
      type: EVENTOS_INDICE.registrada,
      payload,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `idx:${org}:${departamentoId}:${evaluacionId}`,
    };
    await this.store.append(ctx, indiceStreamId(org, departamentoId), idx.version, [input]);
  }

  async responder(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
    cmd: ComandoResponder,
    a: Attribution,
    o: string,
  ): Promise<EvaluacionState> {
    if (!cmd.preguntaId.trim()) throw new EvaluacionInvalidaError('preguntaId requerido');
    const estado = await this.cargar(ctx, departamentoId, evaluacionId);
    this.editable(estado);
    const { estado: estadoResp, valorNormalizado } = normalizarRespuesta(
      cmd.tipoPregunta,
      cmd.entrada,
    );
    const input: EventInput = {
      type: EVENTOS_EVAL.respondida,
      payload: {
        preguntaId: cmd.preguntaId,
        tipoPregunta: cmd.tipoPregunta,
        entrada: cmd.entrada,
        estado: estadoResp,
        valorNormalizado,
        schemaVersion: SCHEMA_VERSION_EVAL,
      },
      attribution: a,
      occurredAt: o,
    };
    await this.store.append(
      ctx,
      evalStreamId(this.org(ctx), departamentoId, evaluacionId),
      estado.version,
      [input],
    );
    return this.cargar(ctx, departamentoId, evaluacionId);
  }

  async generar(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
    generacionId: string,
    a: Attribution,
    o: string,
  ): Promise<EvaluacionState> {
    const estado = await this.cargar(ctx, departamentoId, evaluacionId);
    this.editable(estado);
    if (estado.generaciones.some((g) => g.generacionId === generacionId)) return estado; // idempotente
    const respuestas = aRespuestasDiagnostico(estado);
    const input: EventInput = {
      type: EVENTOS_EVAL.generada,
      payload: {
        generacionId,
        respuestas,
        huella: huellaRespuestas(respuestas),
        schemaVersion: SCHEMA_VERSION_EVAL,
      },
      attribution: a,
      occurredAt: o,
      idempotencyKey: `gen:${generacionId}`,
    };
    await this.store.append(
      ctx,
      evalStreamId(this.org(ctx), departamentoId, evaluacionId),
      estado.version,
      [input],
    );
    return this.cargar(ctx, departamentoId, evaluacionId);
  }

  async cerrar(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
    a: Attribution,
    o: string,
  ): Promise<EvaluacionState> {
    const estado = await this.cargar(ctx, departamentoId, evaluacionId);
    if (estado.cerrada || estado.archivada) return estado;
    await this.store.append(
      ctx,
      evalStreamId(this.org(ctx), departamentoId, evaluacionId),
      estado.version,
      [
        {
          type: EVENTOS_EVAL.cerrada,
          payload: { schemaVersion: SCHEMA_VERSION_EVAL },
          attribution: a,
          occurredAt: o,
          idempotencyKey: `cerrar:${evaluacionId}`,
        },
      ],
    );
    return this.cargar(ctx, departamentoId, evaluacionId);
  }

  async archivar(
    ctx: RequestContext,
    departamentoId: string,
    evaluacionId: string,
    a: Attribution,
    o: string,
  ): Promise<EvaluacionState> {
    const estado = await this.cargar(ctx, departamentoId, evaluacionId);
    if (estado.archivada) return estado;
    await this.store.append(
      ctx,
      evalStreamId(this.org(ctx), departamentoId, evaluacionId),
      estado.version,
      [
        {
          type: EVENTOS_EVAL.archivada,
          payload: { schemaVersion: SCHEMA_VERSION_EVAL },
          attribution: a,
          occurredAt: o,
          idempotencyKey: `archivar:${evaluacionId}`,
        },
      ],
    );
    return this.cargar(ctx, departamentoId, evaluacionId);
  }

  /** Lista las evaluaciones de un (org, departamento) a partir del índice. */
  async listar(ctx: RequestContext, departamentoId: string): Promise<ResumenEvaluacion[]> {
    const org = this.org(ctx);
    const idx = reconstruirIndice(
      org,
      departamentoId,
      await this.store.readStream(ctx, indiceStreamId(org, departamentoId)),
    );
    const resumenes: ResumenEvaluacion[] = [];
    for (const e of idx.evaluaciones) {
      const st = await this.cargar(ctx, departamentoId, e.evaluacionId);
      resumenes.push({
        evaluacionId: e.evaluacionId,
        titulo: st.titulo,
        estado: estadoDe(st),
        creadaEn: st.creadaEn,
        respondidas: Object.values(st.respuestas).filter((r) => r.estado === 'RESPONDIDA').length,
        tieneGeneracion: st.generaciones.length > 0,
      });
    }
    return resumenes;
  }
}
