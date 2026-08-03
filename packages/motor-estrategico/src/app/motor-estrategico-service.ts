/**
 * @soec/motor-estrategico · aplicación · SERVICIO del Motor Estratégico Comercial.
 *
 * Implementa los puertos de lectura y escritura sobre `@soec/event-store`, multi-tenant y con
 * concurrencia optimista (`expectedVersion = state.version`). Reglas de integridad del conocimiento:
 *  - toda afirmación pertenece a UNA organización; jamás se enlaza ni se lee a través de tenants (el
 *    aislamiento lo garantiza el store por `ctx.organizationId`, y los enlaces se validan dentro del tenant);
 *  - un enlace exige que la afirmación destino EXISTA en la misma organización (nunca se enlaza al vacío);
 *  - el estado de evaluabilidad NO se persiste: se deriva con `evaluar()` en cada consulta;
 *  - la inscripción en el índice es idempotente y autorreparable.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  CLASES_AFIRMACION,
  EVENTOS_AFIRMACION,
  type AfirmacionState,
  type ClaseAfirmacion,
  type Enlace,
  type SujetoRef,
  type TipoEnlace,
  afirmacionStreamId,
  reconstruirAfirmacion,
} from '../dominio/afirmacion';
import {
  EVENTOS_INDICE_ESTRATEGICO,
  type EntradaIndice,
  indiceEstrategicoStreamId,
  reconstruirIndice,
} from '../dominio/indice';
import { AfirmacionNoEncontradaError, ComandoEstrategicoInvalidoError, EnlaceInvalidoError } from '../dominio/errors';
import type { Evidencia } from '../nucleo/evidencia';
import { type Evaluacion, type PoliticaEvaluacion, evaluar } from '../nucleo/evaluar';
import type {
  AfirmacionEvaluada,
  EntradaEvidencia,
  EscrituraConocimiento,
  LecturaConocimiento,
} from '../contratos';

export class MotorEstrategicoService implements LecturaConocimiento, EscrituraConocimiento {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private append(
    ctx: RequestContext,
    afirmacionId: string,
    version: number,
    type: string,
    payload: unknown,
    a: Attribution,
    o: string,
  ): Promise<{ version: number }> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, afirmacionStreamId(this.org(ctx), afirmacionId), version, [input]);
  }

  async cargar(ctx: RequestContext, afirmacionId: string): Promise<AfirmacionState> {
    const org = this.org(ctx);
    return reconstruirAfirmacion(org, afirmacionId, await this.store.readStream(ctx, afirmacionStreamId(org, afirmacionId)));
  }

  private async exigir(ctx: RequestContext, afirmacionId: string): Promise<AfirmacionState> {
    const st = await this.cargar(ctx, afirmacionId);
    if (!st.existe) throw new AfirmacionNoEncontradaError(`afirmación ${afirmacionId} no encontrada`);
    return st;
  }

  async registrar(
    ctx: RequestContext,
    afirmacionId: string,
    clase: ClaseAfirmacion,
    enunciado: string,
    a: Attribution,
    o: string,
    opts?: { sujetoRef?: SujetoRef },
  ): Promise<void> {
    if (!afirmacionId?.trim()) throw new ComandoEstrategicoInvalidoError('afirmacionId es obligatorio');
    if (!CLASES_AFIRMACION.includes(clase)) throw new ComandoEstrategicoInvalidoError(`clase desconocida: ${clase}`);
    const st = await this.cargar(ctx, afirmacionId);
    if (!st.existe) {
      if (!enunciado?.trim()) throw new ComandoEstrategicoInvalidoError('el enunciado es obligatorio');
      const payload = { clase, enunciado: enunciado.trim(), ...(opts?.sujetoRef ? { sujetoRef: opts.sujetoRef } : {}) };
      await this.append(ctx, afirmacionId, st.version, EVENTOS_AFIRMACION.registrada, payload, a, o);
    }
    await this.asegurarEnIndice(ctx, afirmacionId, st.existe ? st.clase : clase, (enunciado || st.enunciado).trim(), a, o);
  }

  async agregarEvidencia(
    ctx: RequestContext,
    afirmacionId: string,
    evidencia: EntradaEvidencia,
    a: Attribution,
    o: string,
  ): Promise<void> {
    const st = await this.exigir(ctx, afirmacionId);
    if (!evidencia.evidenciaId?.trim()) throw new ComandoEstrategicoInvalidoError('evidenciaId es obligatorio');
    if (!evidencia.enunciado?.trim()) throw new ComandoEstrategicoInvalidoError('el enunciado de la evidencia es obligatorio');
    if (st.evidencias.some((e) => e.evidenciaId === evidencia.evidenciaId)) return; // idempotente por id
    const sellada: Evidencia = {
      evidenciaId: evidencia.evidenciaId,
      enunciado: evidencia.enunciado.trim(),
      origen: evidencia.origen,
      sentido: evidencia.sentido,
      pertinente: evidencia.pertinente,
      motivoPertinencia: evidencia.motivoPertinencia ?? null,
      fuente: evidencia.fuente ?? null,
    };
    await this.append(ctx, afirmacionId, st.version, EVENTOS_AFIRMACION.evidencia, sellada, a, o);
  }

  async enlazar(
    ctx: RequestContext,
    afirmacionId: string,
    tipo: TipoEnlace,
    hacia: string,
    a: Attribution,
    o: string,
    opts?: { nota?: string },
  ): Promise<void> {
    const st = await this.exigir(ctx, afirmacionId);
    if (!hacia?.trim()) throw new EnlaceInvalidoError('el destino del enlace es obligatorio');
    if (hacia === afirmacionId) throw new EnlaceInvalidoError('una afirmación no puede enlazarse consigo misma');
    // El destino debe EXISTIR en la misma organización: nunca se enlaza al vacío ni cross-tenant.
    const destino = await this.cargar(ctx, hacia);
    if (!destino.existe) throw new EnlaceInvalidoError(`el destino ${hacia} no existe en la organización`);
    const yaExiste = st.enlaces.some((e: Enlace) => e.tipo === tipo && e.hacia === hacia);
    if (yaExiste) return; // idempotente
    await this.append(ctx, afirmacionId, st.version, EVENTOS_AFIRMACION.enlazada, { tipo, hacia, nota: opts?.nota ?? null }, a, o);
  }

  async asignarSujeto(ctx: RequestContext, afirmacionId: string, sujeto: SujetoRef, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, afirmacionId);
    if (!sujeto?.dominio?.trim() || !sujeto?.id?.trim()) {
      throw new ComandoEstrategicoInvalidoError('el sujeto requiere dominio e id');
    }
    if (st.sujetoRef && st.sujetoRef.dominio === sujeto.dominio && st.sujetoRef.id === sujeto.id) return; // idempotente
    await this.append(ctx, afirmacionId, st.version, EVENTOS_AFIRMACION.sujetoAsignado, { dominio: sujeto.dominio, id: sujeto.id }, a, o);
  }

  async retirar(ctx: RequestContext, afirmacionId: string, motivo: string, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, afirmacionId);
    if (!motivo?.trim()) throw new ComandoEstrategicoInvalidoError('el motivo de retiro es obligatorio');
    if (st.retirada) return; // idempotente
    await this.append(ctx, afirmacionId, st.version, EVENTOS_AFIRMACION.retirada, { motivo: motivo.trim() }, a, o);
  }

  async evaluar(ctx: RequestContext, afirmacionId: string, politica?: PoliticaEvaluacion): Promise<AfirmacionEvaluada> {
    const afirmacion = await this.exigir(ctx, afirmacionId);
    if (afirmacion.retirada) {
      // Retirada ⇒ fuera del cómputo (NO_EVALUABLE), pero la explicación es HONESTA: no finge "sin
      // evidencia" cuando la hay; declara el retiro. La historia (evidencia) se conserva en el estado.
      const base = evaluar(afirmacion.enunciado, [], politica);
      const evaluacion: Evaluacion = {
        ...base,
        explicacion: {
          porQue: `afirmación retirada (${afirmacion.motivoRetiro ?? 'sin motivo'}); queda fuera del cómputo de conocimiento`,
          evidenciaUsada: [],
          queFalta: ['reactivar la afirmación o crear una nueva para volver a evaluarla'],
          queImpediriaConcluir: ['la afirmación fue retirada'],
        },
      };
      return { afirmacion, evaluacion };
    }
    return { afirmacion, evaluacion: evaluar(afirmacion.enunciado, afirmacion.evidencias, politica) };
  }

  async listar(ctx: RequestContext, clase?: ClaseAfirmacion): Promise<readonly EntradaIndice[]> {
    const idx = reconstruirIndice(this.org(ctx), await this.store.readStream(ctx, indiceEstrategicoStreamId(this.org(ctx))));
    return clase ? idx.afirmaciones.filter((e) => e.clase === clase) : idx.afirmaciones;
  }

  private async asegurarEnIndice(
    ctx: RequestContext,
    afirmacionId: string,
    clase: ClaseAfirmacion,
    enunciado: string,
    a: Attribution,
    o: string,
  ): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirIndice(org, await this.store.readStream(ctx, indiceEstrategicoStreamId(org)));
    if (idx.afirmaciones.some((e) => e.afirmacionId === afirmacionId)) return; // idempotente / autorreparable
    const input: EventInput = {
      type: EVENTOS_INDICE_ESTRATEGICO.registrada,
      payload: { afirmacionId, clase, enunciado },
      attribution: a,
      occurredAt: o,
    };
    await this.store.append(ctx, indiceEstrategicoStreamId(org), idx.version, [input]);
  }
}
