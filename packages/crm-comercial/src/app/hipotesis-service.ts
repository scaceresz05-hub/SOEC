/**
 * @soec/crm-comercial · aplicación · Servicio de HIPÓTESIS COMERCIALES.
 *
 * Cierra el ciclo hipótesis → evidencia → resultado → aprendizaje, event-sourced y multi-tenant.
 * H-1: no se confirma/refuta sin evidencia coherente (veredictoAdmisible). H-2: el APRENDIZAJE se
 * persiste en su dominio CANÓNICO `@soec/aprendizaje` y la hipótesis solo guarda su `aprendizajeId`
 * (SSOT única). H-6: la inscripción en el índice es idempotente y autorreparable.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { Confianza, TipoEvidencia } from '@soec/negocio';
import { AprendizajeService, type EntradaAprendizaje } from '@soec/aprendizaje';
import { ComandoCrmInvalidoError, HipotesisNoEncontradaError } from '../domain/errors';
import {
  EVENTOS_HIPOTESIS,
  type EvaluacionHipotesis,
  type HipotesisState,
  type Veredicto,
  evaluarHipotesis,
  hipotesisStreamId,
  reconstruirHipotesis,
  transicionValida,
  veredictoAdmisible,
} from '../domain/hipotesis';
import { EVENTOS_HIPINDICE, type HipIndice, hipIndiceStreamId, reconstruirHipIndice } from '../domain/indices';
import { LIMITES, exigirBajoLimite, validarTexto } from '../domain/validacion';
import { ConocimientoComercialService } from './conocimiento-service';

function aConfianzaAprendizaje(c: Confianza): 'baja' | 'media' | 'alta' {
  return c === 'ALTA' ? 'alta' : c === 'MEDIA' ? 'media' : 'baja';
}

export class HipotesisComercialService {
  private readonly aprendizaje: AprendizajeService;
  private readonly conocimiento: ConocimientoComercialService;
  constructor(private readonly store: EventStore, aprendizaje?: AprendizajeService, conocimiento?: ConocimientoComercialService) {
    this.aprendizaje = aprendizaje ?? new AprendizajeService(store);
    this.conocimiento = conocimiento ?? new ConocimientoComercialService(store);
  }

  /**
   * A-2: valida que `segmentoId` refiera a un CLIENTE_IDEAL (ICP) REAL de la MISMA organización. Nunca se
   * infiere ni se acepta un ICP inexistente. Lanza si no existe o no es un cliente ideal.
   */
  private async validarSegmento(ctx: RequestContext, segmentoId: string): Promise<void> {
    if (!segmentoId?.trim()) throw new ComandoCrmInvalidoError('segmentoId es obligatorio');
    const conocimiento = await this.conocimiento.cargar(ctx);
    const ent = conocimiento.entidades[segmentoId];
    if (!ent || ent.tipo !== 'CLIENTE_IDEAL') {
      throw new ComandoCrmInvalidoError(`el segmento ${segmentoId} no es un cliente ideal (ICP) de la organización`);
    }
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, hipotesisId: string): Promise<HipotesisState> {
    const org = this.org(ctx);
    return reconstruirHipotesis(org, hipotesisId, await this.store.readStream(ctx, hipotesisStreamId(org, hipotesisId)));
  }

  async listar(ctx: RequestContext): Promise<HipIndice> {
    return reconstruirHipIndice(await this.store.readStream(ctx, hipIndiceStreamId(this.org(ctx))));
  }

  private append(ctx: RequestContext, hipotesisId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<{ version: number }> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, hipotesisStreamId(this.org(ctx), hipotesisId), version, [input]);
  }

  private async exigir(ctx: RequestContext, hipotesisId: string): Promise<HipotesisState> {
    const st = await this.cargar(ctx, hipotesisId);
    if (!st.existe) throw new HipotesisNoEncontradaError(`hipótesis ${hipotesisId} no encontrada`);
    return st;
  }

  /**
   * Registra una hipótesis. H-6: asegura el agregado y LUEGO el índice (autorreparable). A-2: opcionalmente
   * asocia un segmento/ICP en el registro; si se provee, se valida contra un CLIENTE_IDEAL real de la org.
   */
  async registrar(ctx: RequestContext, hipotesisId: string, enunciado: string, contexto: string, a: Attribution, o: string, opts?: { segmentoId?: string }): Promise<void> {
    if (!hipotesisId?.trim()) throw new ComandoCrmInvalidoError('hipotesisId es obligatorio');
    const st = await this.cargar(ctx, hipotesisId);
    if (!st.existe) {
      if (!enunciado?.trim()) throw new ComandoCrmInvalidoError('enunciado es obligatorio');
      validarTexto(enunciado.trim(), LIMITES.enunciadoHipotesis, 'enunciado');
      validarTexto(contexto ?? '', LIMITES.contextoHipotesis, 'contexto'); // N-2
      if (opts?.segmentoId) await this.validarSegmento(ctx, opts.segmentoId);
      await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.registrada, { enunciado: enunciado.trim(), contexto, ...(opts?.segmentoId ? { segmentoId: opts.segmentoId } : {}) }, a, o);
    }
    await this.asegurarEnIndice(ctx, hipotesisId, (enunciado || st.enunciado).trim(), a, o);
  }

  /**
   * A-2: asocia (o reasigna) EXPLÍCITAMENTE un segmento/ICP a una hipótesis existente. Valida que el ICP
   * exista en la organización. Idempotente: si ya apunta a ese segmento, no emite evento.
   */
  async asociarSegmento(ctx: RequestContext, hipotesisId: string, segmentoId: string, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    await this.validarSegmento(ctx, segmentoId);
    if (st.segmentoId === segmentoId) return; // idempotente
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.segmentoAsociado, { segmentoId }, a, o);
  }

  async agregarEvidencia(ctx: RequestContext, hipotesisId: string, evidenciaId: string, descripcion: string, origen: TipoEvidencia, aFavor: boolean, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!evidenciaId?.trim()) throw new ComandoCrmInvalidoError('evidenciaId obligatorio');
    validarTexto(descripcion ?? '', LIMITES.texto, 'descripción de evidencia');
    exigirBajoLimite(st.evidencias.length, LIMITES.maxEvidencias, 'evidencias');
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.evidencia, { evidenciaId, descripcion, origen, aFavor }, a, o);
  }

  async iniciarPrueba(ctx: RequestContext, hipotesisId: string, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!transicionValida(st.estado, 'EN_PRUEBA')) throw new ComandoCrmInvalidoError(`no se puede pasar de ${st.estado} a EN_PRUEBA`);
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.transicionada, { estado: 'EN_PRUEBA' }, a, o);
  }

  /** Registra el resultado y veredicto. H-1: exige evidencia coherente para CONFIRMAR/REFUTAR. */
  async registrarResultado(ctx: RequestContext, hipotesisId: string, descripcion: string, veredicto: Veredicto, valor: number | null, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!descripcion?.trim()) throw new ComandoCrmInvalidoError('la descripción del resultado es obligatoria'); // N-2
    validarTexto(descripcion.trim(), LIMITES.descripcionResultado, 'descripción de resultado');
    if (!transicionValida(st.estado, veredicto)) throw new ComandoCrmInvalidoError(`no se puede registrar resultado desde ${st.estado} (requiere EN_PRUEBA)`);
    const adm = veredictoAdmisible(st, veredicto);
    if (!adm.ok) throw new ComandoCrmInvalidoError(adm.motivo);
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.resultado, { descripcion, veredicto, valor, en: o }, a, o);
  }

  /**
   * H-2: crea el aprendizaje en su dominio CANÓNICO (`@soec/aprendizaje`) y vincula su id a la
   * hipótesis. Exige un resultado observado y una explicación del porqué. No embebe el contenido.
   */
  async registrarAprendizaje(ctx: RequestContext, hipotesisId: string, porQue: string, transferible: string | null, a: Attribution, o: string): Promise<string> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!porQue?.trim()) throw new ComandoCrmInvalidoError('el aprendizaje exige explicar el porqué');
    validarTexto(porQue.trim(), LIMITES.porQueAprendizaje, 'porqué del aprendizaje'); // N-2
    if (transferible != null) validarTexto(transferible, LIMITES.contextoHipotesis, 'transferible');
    if (!st.resultado) throw new ComandoCrmInvalidoError('no hay resultado observado sobre el cual aprender');
    const ev = evaluarHipotesis(st);
    const aprendizajeId = `hip-${hipotesisId}`;
    const soporte = ev.evaluable && (ev.confianza === 'ALTA' || ev.confianza === 'MEDIA') ? 'evidencia_suficiente' : 'evidencia_insuficiente';
    const entrada: EntradaAprendizaje = {
      observado: { experimentoId: `hip:${hipotesisId}`, ganador: null, valorControl: 0, valorVariante: st.resultado.valor ?? 0, observaciones: st.evidencias.length, evidencia: st.resultado.descripcion },
      interpretacion: { texto: porQue.trim(), supuestos: [], confianza: aConfianzaAprendizaje(ev.confianza) },
      conclusion: { enunciado: `${st.enunciado} → ${st.resultado.veredicto}`, soporte, accionRecomendada: transferible ?? 'sin acción reutilizable declarada' },
      ...(transferible ? { reutilizable: { enunciado: transferible, condiciones: [st.contexto], ambitoSugerido: [this.org(ctx)] } } : {}),
    };
    await this.aprendizaje.registrar(ctx, aprendizajeId, entrada, a, o); // idempotente por aprendizajeId
    const fresco = await this.cargar(ctx, hipotesisId);
    await this.append(ctx, hipotesisId, fresco.version, EVENTOS_HIPOTESIS.aprendizajeVinculado, { aprendizajeId }, a, o);
    return aprendizajeId;
  }

  async evaluar(ctx: RequestContext, hipotesisId: string): Promise<EvaluacionHipotesis> {
    return evaluarHipotesis(await this.exigir(ctx, hipotesisId));
  }

  /** H-6: inscribe en el índice de forma idempotente; reparable aunque el agregado ya exista. */
  private async asegurarEnIndice(ctx: RequestContext, hipotesisId: string, enunciado: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirHipIndice(await this.store.readStream(ctx, hipIndiceStreamId(org)));
    if (idx.hipotesis.some((h) => h.hipotesisId === hipotesisId)) return;
    const input: EventInput = { type: EVENTOS_HIPINDICE.registrada, payload: { hipotesisId, enunciado }, attribution: a, occurredAt: o };
    await this.store.append(ctx, hipIndiceStreamId(org), idx.version, [input]);
  }
}
