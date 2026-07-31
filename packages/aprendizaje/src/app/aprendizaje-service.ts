/**
 * Servicio de aprendizaje (Bloque G). Persiste aprendizaje ESTRUCTURADO en cuatro capas y
 * gobierna su reutilización entre organizaciones. Invariantes:
 *   - Estructura obligatoria: resultado observado + interpretación + conclusión (las tres capas
 *     mínimas). El aprendizaje reutilizable es opcional pero, si existe, es explícito.
 *   - Separación con criterio: registrar y leer ocurre bajo la organización de origen. Aplicar
 *     el aprendizaje a OTRA organización exige una DECISIÓN HUMANA (actor humano + decisión +
 *     justificación); sin ella se rechaza. Aplicarlo a la propia organización no la requiere.
 * Event-sourced (`aprendizaje:<org>:<id>`).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { ResultadoExperimento } from '@soec/medicion';
import {
  type Aprendizaje,
  type AprendizajeReutilizable,
  type Conclusion,
  type Interpretacion,
  type ResultadoObservado,
  EVENTOS_APRENDIZAJE,
  aprendizajeStreamId,
  reconstruirAprendizaje,
} from '../domain/aprendizaje';
import { AplicacionSinDecisionHumanaError, AprendizajeInvalidoError } from '../domain/errors';

export interface EntradaAprendizaje {
  readonly observado: ResultadoObservado;
  readonly interpretacion: Interpretacion;
  readonly conclusion: Conclusion;
  readonly reutilizable?: AprendizajeReutilizable;
}

export interface DecisionHumana {
  readonly actorHumano: string;
  readonly decisionId: string;
  readonly justificacion: string;
}

/** Construye la capa de resultado observado a partir de un `ResultadoExperimento` de @soec/medicion. */
export function observadoDesdeExperimento(experimentoId: string, r: ResultadoExperimento, observaciones: number): ResultadoObservado {
  return { experimentoId, ganador: r.ganador, valorControl: r.valorControl, valorVariante: r.valorVariante, observaciones, evidencia: r.evidencia };
}

export class AprendizajeService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, aprendizajeId: string): Promise<Aprendizaje> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, aprendizajeStreamId(org, aprendizajeId)).then((e) => reconstruirAprendizaje(org, aprendizajeId, e));
  }

  async registrar(ctx: RequestContext, aprendizajeId: string, entrada: EntradaAprendizaje, a: Attribution, o: string): Promise<Aprendizaje> {
    // Estructura obligatoria: sin las tres capas mínimas no es un aprendizaje, es una nota suelta.
    if (!entrada.observado?.experimentoId) throw new AprendizajeInvalidoError('falta el resultado observado (capa 1)');
    if (!entrada.interpretacion?.texto.trim()) throw new AprendizajeInvalidoError('falta la interpretación (capa 2)');
    if (!entrada.conclusion?.enunciado.trim()) throw new AprendizajeInvalidoError('falta la conclusión (capa 3)');

    const existente = await this.cargar(ctx, aprendizajeId);
    if (existente.existe) return existente;

    const payload = {
      observado: entrada.observado,
      interpretacion: entrada.interpretacion,
      conclusion: entrada.conclusion,
      reutilizable: entrada.reutilizable ?? null,
    };
    const input: EventInput = {
      type: EVENTOS_APRENDIZAJE.registrado,
      payload,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `registrar:${aprendizajeStreamId(this.org(ctx), aprendizajeId)}`,
    };
    await this.store.append(ctx, aprendizajeStreamId(this.org(ctx), aprendizajeId), existente.version, [input]);
    return this.cargar(ctx, aprendizajeId);
  }

  /**
   * Aplica el aprendizaje a una organización destino. Si el destino es distinto de la
   * organización de origen, EXIGE una decisión humana explícita. Nunca cruza solo.
   */
  async aplicarEn(
    ctx: RequestContext,
    aprendizajeId: string,
    organizacionDestino: string,
    decision: DecisionHumana | null,
    a: Attribution,
    o: string,
  ): Promise<Aprendizaje> {
    const ap = await this.cargar(ctx, aprendizajeId);
    if (!ap.existe) throw new AprendizajeInvalidoError('el aprendizaje no existe');

    const esCruce = organizacionDestino !== ap.organizacionOrigen;
    if (esCruce && (!decision || !decision.actorHumano || !decision.decisionId)) {
      throw new AplicacionSinDecisionHumanaError(
        `aplicar un aprendizaje de '${ap.organizacionOrigen}' a '${organizacionDestino}' requiere una decisión humana explícita`,
      );
    }

    const aplicacion = {
      organizacionDestino,
      actorHumano: decision?.actorHumano ?? String(ctx.actor),
      decisionId: decision?.decisionId ?? '',
      justificacion: decision?.justificacion ?? 'aplicación dentro de la organización de origen',
      en: o,
    };
    const input: EventInput = { type: EVENTOS_APRENDIZAJE.aplicado, payload: aplicacion, attribution: a, occurredAt: o };
    await this.store.append(ctx, aprendizajeStreamId(this.org(ctx), aprendizajeId), ap.version, [input]);
    return this.cargar(ctx, aprendizajeId);
  }
}
