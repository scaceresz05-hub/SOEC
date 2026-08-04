/**
 * @soec/motor-optimizacion · aplicación · SERVICIO DE PROPUESTAS (M9).
 *
 * Crea propuestas gobernadas, las somete a APROBACIÓN HUMANA CANÓNICA (AprobacionService), y —sólo si están
 * APROBADAS y vigentes— las APLICA de forma SIMULADA creando NUEVAS versiones (vía `AplicadorCambios`), nunca
 * sobrescribiendo. Reglas: no autoaprobar; no heredar aprobación entre versiones; un cambio M5–M8 invalida la
 * aprobación pendiente; una propuesta rechazada no se aplica; una aprobada pero obsoleta requiere revisión;
 * guarda de oscilación antes de aplicar. Registra todo en la memoria de decisiones. Multi-tenant.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import { AprobacionService } from '@soec/estrategia-creativa';
import {
  EVENTOS_PROPUESTA, type CuerpoPropuesta, type Derivacion, type PropuestaState,
  propuestaStreamId, reconstruirPropuesta,
} from '../dominio/propuesta';
import { permitirCambio, type PoliticaOscilacion } from '../dominio/politica-oscilacion';
import { OptimizacionService } from './optimizacion-service';
import { MemoriaDecisionesService } from './memoria-decisiones-service';
import type { AplicadorCambios } from '../contratos';
import { ComandoOptimizacionInvalidoError, PropuestaNoEncontradaError, AprobacionInvalidaError } from '../dominio/errors';

const EVENTOS_PROP_INDICE = { registrada: 'propuesta-indice.registrada' } as const;
function propIndiceStreamId(org: string): string { return `propuesta-opt-indice:${org}`; }

export interface DecisionHumana { readonly actorHumano: string; readonly decisionId: string; readonly justificacion: string }
export interface ResultadoAplicacion { readonly aplicada: boolean; readonly motivo: string; readonly derivaciones: readonly Derivacion[] }

export class PropuestaService {
  constructor(
    private readonly store: EventStore,
    private readonly optimizacion: OptimizacionService,
    private readonly aprobacion: AprobacionService,
    private readonly aplicador: AplicadorCambios,
    private readonly memoria: MemoriaDecisionesService,
  ) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, propuestaId: string): Promise<PropuestaState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, propuestaStreamId(org, propuestaId)).then((e) => reconstruirPropuesta(org, propuestaId, e));
  }

  private async append(ctx: RequestContext, propuestaId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, propuestaId);
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, propuestaStreamId(this.org(ctx), propuestaId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  /** Crea la propuesta (BORRADOR→PENDIENTE_APROBACION) y la vincula al ciclo. Idempotente por propuestaId. */
  async proponer(ctx: RequestContext, propuestaId: string, cuerpo: CuerpoPropuesta, a: Attribution, o: string): Promise<PropuestaState> {
    if (!propuestaId?.trim() || !cuerpo.cicloId?.trim()) throw new ComandoOptimizacionInvalidoError('propuestaId y cicloId son obligatorios');
    const st = await this.cargar(ctx, propuestaId);
    if (!st.existe) await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.creada, { cuerpo }, a, o);
    await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.pendiente, {}, a, o);
    // El ciclo referencia la propuesta ANTES del índice: si el índice falla, el reconciliador aún la descubre.
    await this.optimizacion.vincularPropuesta(ctx, cuerpo.cicloId, propuestaId, a, o);
    await this.asegurarEnIndice(ctx, propuestaId, a, o);
    return this.cargar(ctx, propuestaId);
  }

  /**
   * Aprobación HUMANA. Revalida la vigencia M5–M8 (un cambio invalida la aprobación pendiente → la propuesta
   * pasa a OBSOLETA en vez de aprobarse). No autoaprueba (exige actorHumano). Usa la aprobación CANÓNICA.
   */
  async aprobar(ctx: RequestContext, propuestaId: string, d: DecisionHumana, a: Attribution, o: string): Promise<PropuestaState> {
    if (!d.actorHumano?.trim()) throw new AprobacionInvalidaError('la aprobación exige un actor humano (no autoaprobar)');
    const st = await this.exigir(ctx, propuestaId);
    if (st.estado !== 'PENDIENTE_APROBACION') return st;
    const coh = await this.optimizacion.verificarCoherencia(ctx, { objetivo: '', segmento: '', versionesBase: st.cuerpo!.versionesBase, presupuestoDisponible: 0 });
    if (!coh.coherente) {
      await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.obsoleta, { motivo: `aprobación invalidada: ${coh.motivo}` }, a, o);
      await this.memoria.registrar(ctx, { cicloId: st.cuerpo!.cicloId, propuestaId, decision: 'OBSOLETA', actorHumano: d.actorHumano, motivo: coh.motivo, aplicada: false, derivaciones: [], cambios: [], en: o }, a, o);
      return this.cargar(ctx, propuestaId);
    }
    // Aprobación CANÓNICA (idempotente, ligada a la versión del recurso).
    await this.aprobacion.decidir(ctx, { resourceType: 'PROPUESTA_OPTIMIZACION', resourceId: propuestaId, resourceVersion: st.version, decision: 'APROBADA' }, a, o);
    await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.aprobada, { aprobacion: d }, a, o);
    await this.optimizacion.resolver(ctx, st.cuerpo!.cicloId, 'APROBADO', a, o);
    await this.memoria.registrar(ctx, { cicloId: st.cuerpo!.cicloId, propuestaId, decision: 'APROBADA', actorHumano: d.actorHumano, motivo: d.justificacion, aplicada: false, derivaciones: [], cambios: [], en: o }, a, o);
    return this.cargar(ctx, propuestaId);
  }

  async rechazar(ctx: RequestContext, propuestaId: string, d: DecisionHumana, a: Attribution, o: string): Promise<PropuestaState> {
    const st = await this.exigir(ctx, propuestaId);
    if (st.estado !== 'PENDIENTE_APROBACION') return st;
    await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.rechazada, { aprobacion: d }, a, o);
    await this.optimizacion.resolver(ctx, st.cuerpo!.cicloId, 'RECHAZADO', a, o);
    await this.memoria.registrar(ctx, { cicloId: st.cuerpo!.cicloId, propuestaId, decision: 'RECHAZADA', actorHumano: d.actorHumano, motivo: d.justificacion, aplicada: false, derivaciones: [], cambios: [], en: o }, a, o);
    return this.cargar(ctx, propuestaId);
  }

  /**
   * Aplicación SIMULADA: sólo si APROBADA y vigente. Revalida coherencia (aprobada-pero-obsoleta→revisión),
   * aplica la guarda de OSCILACIÓN, y crea NUEVAS versiones vía el aplicador canónico. Registra la memoria.
   */
  async aplicarSimulado(ctx: RequestContext, propuestaId: string, pol: PoliticaOscilacion, ahora: string, a: Attribution, o: string): Promise<ResultadoAplicacion> {
    const st = await this.exigir(ctx, propuestaId);
    // Idempotente: si YA está aplicada (p. ej. falló el cierre del ciclo o la memoria), se re-asegura el
    // cierre del ciclo y el registro de memoria; no se re-aplican los cambios.
    if (st.estado === 'APLICADA_SIMULADA') {
      const cc = st.cuerpo!;
      await this.optimizacion.marcarAplicado(ctx, cc.cicloId, 'aplicado (simulado)', a, o);
      if (st.derivaciones.length > 0) await this.memoria.registrar(ctx, { cicloId: cc.cicloId, propuestaId, decision: 'APLICADA', actorHumano: st.aprobacion?.actorHumano ?? null, motivo: 'aplicación simulada', aplicada: true, derivaciones: st.derivaciones, cambios: (cc.alternativaElegida?.cambia ?? []).map((variable) => ({ variable, valor: cc.alternativaElegida!.alternativaId, en: o })), en: o }, a, o);
      return { aplicada: true, motivo: 'ya aplicada', derivaciones: st.derivaciones };
    }
    if (st.estado !== 'APROBADA') return { aplicada: false, motivo: `no aplicable en estado ${st.estado}`, derivaciones: [] };
    const c = st.cuerpo!;
    const coh = await this.optimizacion.verificarCoherencia(ctx, { objetivo: '', segmento: '', versionesBase: c.versionesBase, presupuestoDisponible: 0 });
    if (!coh.coherente) {
      await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.obsoleta, { motivo: `aplicación abortada: ${coh.motivo}` }, a, o);
      return { aplicada: false, motivo: `obsoleta al aplicar: ${coh.motivo}`, derivaciones: [] };
    }
    const alt = c.alternativaElegida;
    if (!alt || alt.cambia.length === 0) { // NO_ACTUAR / sin cambios ⇒ no se crean versiones
      await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.aplicada, { derivaciones: [] }, a, o);
      await this.optimizacion.marcarAplicado(ctx, c.cicloId, 'sin cambios (no actuar)', a, o);
      return { aplicada: true, motivo: 'sin cambios', derivaciones: [] };
    }
    // Guarda de OSCILACIÓN sobre el historial de cambios aplicados.
    const historial = await this.memoria.historialCambios(ctx);
    for (const variable of alt.cambia) {
      const vered = permitirCambio(historial, { variable, valor: alt.alternativaId }, pol, ahora);
      if (!vered.permitido) return { aplicada: false, motivo: vered.motivo, derivaciones: [] };
    }
    // Aplicación canónica ⇒ nuevas versiones + derivaciones.
    const derivaciones: Derivacion[] = [];
    for (const variable of alt.cambia) {
      derivaciones.push(await this.aplicador.aplicar(ctx, { variable, valorNuevo: alt.alternativaId, versionesBase: c.versionesBase }, a, o));
    }
    await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.aplicada, { derivaciones }, a, o);
    await this.optimizacion.marcarAplicado(ctx, c.cicloId, 'aplicado (simulado)', a, o);
    await this.memoria.registrar(ctx, {
      cicloId: c.cicloId, propuestaId, decision: 'APLICADA', actorHumano: st.aprobacion?.actorHumano ?? null, motivo: 'aplicación simulada',
      aplicada: true, derivaciones, cambios: alt.cambia.map((variable) => ({ variable, valor: alt.alternativaId, en: o })), en: o,
    }, a, o);
    return { aplicada: true, motivo: 'aplicada (simulada)', derivaciones };
  }

  async obsoletar(ctx: RequestContext, propuestaId: string, motivo: string, a: Attribution, o: string): Promise<PropuestaState> {
    await this.append(ctx, propuestaId, EVENTOS_PROPUESTA.obsoleta, { motivo }, a, o);
    return this.cargar(ctx, propuestaId);
  }

  private async exigir(ctx: RequestContext, propuestaId: string): Promise<PropuestaState> {
    const st = await this.cargar(ctx, propuestaId);
    if (!st.existe) throw new PropuestaNoEncontradaError(`propuesta ${propuestaId} no encontrada`);
    return st;
  }

  private async asegurarEnIndice(ctx: RequestContext, propuestaId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, propIndiceStreamId(org));
    if (events.some((e) => e.type === EVENTOS_PROP_INDICE.registrada && (e.payload as { propuestaId: string }).propuestaId === propuestaId)) return;
    try { await this.store.append(ctx, propIndiceStreamId(org), events.length, [{ type: EVENTOS_PROP_INDICE.registrada, payload: { propuestaId }, attribution: a, occurredAt: o }]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listarIds(ctx: RequestContext): Promise<readonly string[]> {
    const events = await this.store.readStream(ctx, propIndiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_PROP_INDICE.registrada).map((e) => (e.payload as { propuestaId: string }).propuestaId);
  }

  async estaEnIndice(ctx: RequestContext, propuestaId: string): Promise<boolean> {
    const events = await this.store.readStream(ctx, propIndiceStreamId(this.org(ctx)));
    return events.some((e) => e.type === EVENTOS_PROP_INDICE.registrada && (e.payload as { propuestaId: string }).propuestaId === propuestaId);
  }

  async reindexar(ctx: RequestContext, propuestaId: string, a: Attribution, o: string): Promise<void> { await this.asegurarEnIndice(ctx, propuestaId, a, o); }
}
