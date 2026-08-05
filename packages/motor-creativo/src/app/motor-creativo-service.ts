/**
 * @soec/motor-creativo · aplicación · SERVICIO del Motor Creativo Estratégico (M6).
 *
 * Orquesta sobre `@soec/event-store` (multi-tenant, concurrencia optimista) y consume M5 SOLO por el
 * puerto `LecturaConocimiento` (nunca lee modelos concretos de M5). Produce y gobierna: contexto creativo
 * (puente versionado desde M5, con obsolescencia), territorios evaluables, y la validación creativa
 * AUTORITATIVA (texto A-3 + respaldo epistémico real). Nunca publica, programa, gasta ni llama canales.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import { type EntradaValidacionContenido, validarContenidoComercial } from '@soec/estrategia-creativa';
import { ComandoCreativoInvalidoError, EntidadCreativaNoEncontradaError } from '../dominio/errors';
import {
  EVENTOS_CONTEXTO,
  type ContextoCreativoState,
  type DesajusteReferencia,
  type ReferenciaConocimiento,
  type RolConocimiento,
  contextoCreativoStreamId,
  detectarObsolescencia,
  reconstruirContexto,
} from '../dominio/contexto-creativo';
import {
  EVENTOS_TERRITORIO,
  type ContenidoTerritorio,
  type EvidenciaTerritorio,
  type TerritorioState,
  reconstruirTerritorio,
  territorioStreamId,
} from '../dominio/territorio';
import {
  EVENTOS_INDICE_TERRITORIO,
  type EntradaIndiceTerritorio,
  indiceTerritoriosStreamId,
  reconstruirIndiceTerritorios,
} from '../dominio/indice-territorios';
import type { MensajeCreativo } from '../dominio/mensaje';
import { type ResultadoCreativo, abstener, proponer } from '../dominio/abstencion';
import {
  type RespaldoAfirmacion,
  type VeredictoAutoritativo,
  combinarVeredicto,
} from '../dominio/validacion-autoritativa';
import type { EntradaTerritorio, EvaluacionTerritorio } from '../contratos';

/** Un rol solicitado para construir el contexto: qué afirmación de M5 cumple qué rol creativo. */
export interface RolSolicitado {
  readonly rol: RolConocimiento;
  readonly afirmacionId: string;
}

/** Un mensaje a validar: su id y la afirmación de M5 que dice respaldarlo (o null). */
export interface MensajeARespaldar {
  readonly mensajeId: string;
  readonly afirmacionRespaldoId: string | null;
}

export class MotorCreativoService {
  constructor(
    private readonly store: EventStore,
    private readonly conocimiento: LecturaConocimiento,
  ) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private appendContexto(ctx: RequestContext, id: string, version: number, type: string, payload: unknown, a: Attribution, o: string) {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, contextoCreativoStreamId(this.org(ctx), id), version, [input]);
  }

  private appendTerritorio(ctx: RequestContext, id: string, version: number, type: string, payload: unknown, a: Attribution, o: string) {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, territorioStreamId(this.org(ctx), id), version, [input]);
  }

  // ── Contexto creativo (puente desde M5) ─────────────────────────────────────────────────────────

  async cargarContexto(ctx: RequestContext, contextoId: string): Promise<ContextoCreativoState> {
    const org = this.org(ctx);
    return reconstruirContexto(org, contextoId, await this.store.readStream(ctx, contextoCreativoStreamId(org, contextoId)));
  }

  /**
   * Construye (o reconstruye como nueva versión) el contexto creativo a partir de M5. Para cada rol pide
   * la afirmación a `LecturaConocimiento`: registra su versión y estado; si no existe o no es evaluable,
   * lo declara FALTANTE (la ausencia no se disfraza de dato).
   */
  async construirContexto(ctx: RequestContext, contextoId: string, roles: readonly RolSolicitado[], a: Attribution, o: string): Promise<ContextoCreativoState> {
    if (!contextoId?.trim()) throw new ComandoCreativoInvalidoError('contextoId es obligatorio');
    const referencias: ReferenciaConocimiento[] = [];
    const faltantes: string[] = [];
    for (const { rol, afirmacionId } of roles) {
      const af = await this.conocimiento.cargar(ctx, afirmacionId);
      if (!af.existe) {
        faltantes.push(`${rol}: la afirmación ${afirmacionId} no existe en M5`);
        continue;
      }
      const { evaluacion } = await this.conocimiento.evaluar(ctx, afirmacionId);
      referencias.push({ rol, afirmacionId, clase: af.clase, version: af.version, estado: evaluacion.estado });
      if (evaluacion.estado === 'NO_EVALUABLE') {
        faltantes.push(`${rol}: el conocimiento de M5 no es evaluable (${afirmacionId})`);
      }
    }
    const st = await this.cargarContexto(ctx, contextoId);
    // Idempotente por contenido: reconstruir con las MISMAS referencias/faltantes (y no obsoleto) no
    // versiona (permite reintentos y concurrencia limpia). Un cambio real de M5 sí produce nueva versión.
    const nuevoCanon = JSON.stringify({ referencias, faltantes });
    if (st.existe && !st.obsoleto && JSON.stringify({ referencias: st.referencias, faltantes: st.faltantes }) === nuevoCanon) {
      return st;
    }
    await this.appendContexto(ctx, contextoId, st.version, EVENTOS_CONTEXTO.construido, { referencias, faltantes }, a, o);
    return this.cargarContexto(ctx, contextoId);
  }

  /**
   * Verifica la VIGENCIA del contexto contra M5: relee la versión actual de cada afirmación referenciada
   * y detecta desajustes. Si alguno cambió (o desapareció), marca el contexto OBSOLETO (no lo muta en
   * silencio). Devuelve los desajustes (vacío ⇒ vigente).
   */
  async verificarVigencia(ctx: RequestContext, contextoId: string, a: Attribution, o: string): Promise<readonly DesajusteReferencia[]> {
    const st = await this.cargarContexto(ctx, contextoId);
    if (!st.existe) throw new EntidadCreativaNoEncontradaError(`contexto ${contextoId} no encontrado`);
    const versionesActuales: Record<string, number> = {};
    for (const ref of st.referencias) {
      const af = await this.conocimiento.cargar(ctx, ref.afirmacionId);
      if (af.existe) versionesActuales[ref.afirmacionId] = af.version;
    }
    const desajustes = detectarObsolescencia(st, versionesActuales);
    if (desajustes.length > 0 && !st.obsoleto) {
      const motivo = `${desajustes.length} referencia(s) de M5 cambiaron de versión`;
      await this.appendContexto(ctx, contextoId, st.version, EVENTOS_CONTEXTO.obsoleto, { motivo }, a, o);
    }
    return desajustes;
  }

  // ── Territorios ─────────────────────────────────────────────────────────────────────────────────

  async cargarTerritorio(ctx: RequestContext, territorioId: string): Promise<TerritorioState> {
    const org = this.org(ctx);
    return reconstruirTerritorio(org, territorioId, await this.store.readStream(ctx, territorioStreamId(org, territorioId)));
  }

  async registrarTerritorio(ctx: RequestContext, territorioId: string, contenido: ContenidoTerritorio, a: Attribution, o: string): Promise<void> {
    if (!territorioId?.trim()) throw new ComandoCreativoInvalidoError('territorioId es obligatorio');
    if (!contenido.tesis?.trim()) throw new ComandoCreativoInvalidoError('la tesis del territorio es obligatoria');
    const st = await this.cargarTerritorio(ctx, territorioId);
    const tipo = st.existe ? EVENTOS_TERRITORIO.actualizado : EVENTOS_TERRITORIO.registrado;
    await this.appendTerritorio(ctx, territorioId, st.version, tipo, contenido, a, o);
    await this.asegurarEnIndice(ctx, territorioId, contenido.tesis, a, o);
  }

  async agregarEvidenciaTerritorio(ctx: RequestContext, territorioId: string, evidencia: EvidenciaTerritorio, a: Attribution, o: string): Promise<void> {
    const st = await this.exigirTerritorio(ctx, territorioId);
    if (!evidencia.afirmacionId?.trim()) throw new ComandoCreativoInvalidoError('la evidencia requiere afirmacionId');
    await this.appendTerritorio(ctx, territorioId, st.version, EVENTOS_TERRITORIO.evidencia, evidencia, a, o);
  }

  async retirarTerritorio(ctx: RequestContext, territorioId: string, a: Attribution, o: string): Promise<void> {
    const st = await this.exigirTerritorio(ctx, territorioId);
    if (st.retirado) return;
    await this.appendTerritorio(ctx, territorioId, st.version, EVENTOS_TERRITORIO.retirado, {}, a, o);
  }

  async listarTerritorios(ctx: RequestContext): Promise<readonly EntradaTerritorio[]> {
    const org = this.org(ctx);
    const idx = reconstruirIndiceTerritorios(org, await this.store.readStream(ctx, indiceTerritoriosStreamId(org)));
    return idx.territorios.map((t) => ({ territorioId: t.territorioId, tesis: t.tesis }));
  }

  private async exigirTerritorio(ctx: RequestContext, territorioId: string): Promise<TerritorioState> {
    const st = await this.cargarTerritorio(ctx, territorioId);
    if (!st.existe) throw new EntidadCreativaNoEncontradaError(`territorio ${territorioId} no encontrado`);
    return st;
  }

  private async asegurarEnIndice(ctx: RequestContext, territorioId: string, tesis: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirIndiceTerritorios(org, await this.store.readStream(ctx, indiceTerritoriosStreamId(org)));
    if (idx.territorios.some((t) => t.territorioId === territorioId)) return; // idempotente / autorreparable
    const entrada: EntradaIndiceTerritorio = { territorioId, tesis };
    const input: EventInput = { type: EVENTOS_INDICE_TERRITORIO.registrado, payload: entrada, attribution: a, occurredAt: o };
    await this.store.append(ctx, indiceTerritoriosStreamId(org), idx.version, [input]);
  }

  /**
   * Evalúa un territorio DERIVANDO su sostén desde M5 (nunca almacena el veredicto). Se abstiene con
   * explicación si falta audiencia sostenida o no hay evidencia sostenida: la ausencia no es una propuesta.
   */
  async evaluarTerritorio(ctx: RequestContext, territorioId: string): Promise<ResultadoCreativo<EvaluacionTerritorio>> {
    const t = await this.exigirTerritorio(ctx, territorioId);
    if (t.retirado) {
      return abstener('EVIDENCIA_INSUFICIENTE', {
        porQue: 'el territorio fue retirado; queda fuera del cómputo creativo',
        evidenciaUsada: [],
        queFalta: ['reactivar o recrear el territorio'],
        queImpediriaConcluir: ['territorio retirado'],
      });
    }
    if (!t.audienciaRef) {
      return abstener('FALTA_AUDIENCIA', {
        porQue: 'el territorio no declara audiencia (ICP/Buyer Persona)',
        evidenciaUsada: [],
        queFalta: ['asociar una audiencia (afirmación ICP o BUYER_PERSONA de M5)'],
        queImpediriaConcluir: ['sin audiencia no hay dirección creativa dirigida'],
      });
    }
    const aud = await this.conocimiento.cargar(ctx, t.audienciaRef);
    const audienciaSostenida = aud.existe && (await this.conocimiento.evaluar(ctx, t.audienciaRef)).evaluacion.estado === 'VERDADERO';
    let sostenidas = 0;
    const usadas: string[] = [];
    for (const ev of t.evidencias) {
      const af = await this.conocimiento.cargar(ctx, ev.afirmacionId);
      if (!af.existe) continue;
      const { evaluacion } = await this.conocimiento.evaluar(ctx, ev.afirmacionId);
      if (evaluacion.estado === 'VERDADERO') {
        sostenidas += 1;
        usadas.push(ev.afirmacionId);
      }
    }
    if (!audienciaSostenida) {
      return abstener('FALTA_AUDIENCIA', {
        porQue: 'la audiencia declarada no está sostenida en M5 (no evalúa VERDADERO)',
        evidenciaUsada: usadas,
        queFalta: ['sostener el ICP/Buyer Persona con evidencia suficiente en M5'],
        queImpediriaConcluir: ['audiencia no sostenida'],
      });
    }
    if (sostenidas === 0) {
      return abstener('EVIDENCIA_INSUFICIENTE', {
        porQue: 'ninguna evidencia del territorio está sostenida en M5',
        evidenciaUsada: [],
        queFalta: ['al menos una afirmación de M5 evaluada VERDADERO que respalde el territorio'],
        queImpediriaConcluir: ['sin evidencia sostenida no hay tesis creativa concluyente'],
      });
    }
    return proponer({ territorioId, sostenidas, totalEvidencias: t.evidencias.length, audienciaSostenida });
  }

  // ── Validación creativa AUTORITATIVA (texto A-3 + respaldo epistémico M5) ────────────────────────

  /**
   * Gate obligatorio: valida el TEXTO con el validador A-3 (reusado) y, además, resuelve cada mensaje con
   * respaldo declarado contra M5 (`LecturaConocimiento`). Solo autoriza si el texto pasa y TODA afirmación
   * de respaldo existe, no está retirada y evalúa VERDADERO. La trazabilidad epistémica es autoritativa.
   */
  async validarContenido(
    ctx: RequestContext,
    entrada: EntradaValidacionContenido,
    mensajes: readonly MensajeARespaldar[],
    _a?: Attribution,
  ): Promise<VeredictoAutoritativo> {
    const textual = validarContenidoComercial(entrada);
    const respaldos: RespaldoAfirmacion[] = [];
    for (const m of mensajes) {
      if (!m.afirmacionRespaldoId) continue; // sin respaldo declarado → no aporta un respaldo a resolver
      const af = await this.conocimiento.cargar(ctx, m.afirmacionRespaldoId);
      const estado = af.existe ? (await this.conocimiento.evaluar(ctx, m.afirmacionRespaldoId)).evaluacion.estado : 'NO_EVALUABLE';
      respaldos.push({ mensajeId: m.mensajeId, afirmacionId: m.afirmacionRespaldoId, existe: af.existe, retirada: af.retirada, estado });
    }
    return combinarVeredicto(textual, respaldos);
  }

  /**
   * Validación AUTORITATIVA COMPLETA para el pipeline: además del texto A-3 y del respaldo VERDADERO,
   * verifica que la VERSIÓN de M5 no cambió respecto de la esperada (obsolescencia) y que la CLASE de la
   * afirmación autoriza el TIPO de mensaje. Resuelve todo contra M5 por `LecturaConocimiento`.
   */
  async validarMensajesAutoritativo(
    ctx: RequestContext,
    entrada: EntradaValidacionContenido,
    mensajes: readonly MensajeCreativo[],
    versionesEsperadas: Readonly<Record<string, number>>,
  ): Promise<VeredictoAutoritativo> {
    const textual = validarContenidoComercial(entrada);
    const respaldos: RespaldoAfirmacion[] = [];
    for (const m of mensajes) {
      if (!m.afirmacionRespaldoId) continue;
      const af = await this.conocimiento.cargar(ctx, m.afirmacionRespaldoId);
      const estado = af.existe ? (await this.conocimiento.evaluar(ctx, m.afirmacionRespaldoId)).evaluacion.estado : 'NO_EVALUABLE';
      const r: RespaldoAfirmacion = {
        mensajeId: m.mensajeId,
        afirmacionId: m.afirmacionRespaldoId,
        existe: af.existe,
        retirada: af.retirada,
        estado,
        tipoMensaje: m.tipo,
        ...(af.existe ? { versionActual: af.version, clase: af.clase } : {}),
        ...(Object.prototype.hasOwnProperty.call(versionesEsperadas, m.afirmacionRespaldoId) ? { versionEsperada: versionesEsperadas[m.afirmacionRespaldoId]! } : {}),
      };
      respaldos.push(r);
    }
    return combinarVeredicto(textual, respaldos);
  }
}
