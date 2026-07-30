/**
 * Servicio de autonomía y modo seguro (Bloque H). Es el guardián que C/D/E deben consultar
 * antes de cualquier acción con efecto. Persiste política, autorizaciones humanas, pausas,
 * reanudaciones y acciones en vuelo. No decide por conveniencia: aplica las invariantes de
 * seguridad de forma determinista. Event-sourced (`autonomia:<org>`).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type AccionGobernada,
  type Autorizacion,
  type EstadoAutonomia,
  type Solicitante,
  type Veredicto,
  EVENTOS_AUTONOMIA,
  autonomiaStreamId,
  puedeContinuar,
  puedeEjecutar,
  reconstruirAutonomia,
} from '../domain/autonomia';
import { AutonomiaInvalidaError, AutonomiaNoAutoElevableError, ReanudacionSinActorHumanoError } from '../domain/errors';

export interface OtorgarAutorizacionCmd {
  readonly accion: AccionGobernada;
  readonly entidadRef: string;
  readonly actorHumano: string;
  readonly otorgadaEn: string;
  readonly expiraEn: string;
}

export class AutonomiaService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext): Promise<EstadoAutonomia> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, autonomiaStreamId(org)).then((e) => reconstruirAutonomia(org, e));
  }

  private async append(ctx: RequestContext, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<EstadoAutonomia> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    await this.store.append(ctx, autonomiaStreamId(this.org(ctx)), version, [input]);
    return this.cargar(ctx);
  }

  /** Fija el nivel de autonomía inicial de la organización. */
  async establecerPolitica(ctx: RequestContext, nivel: number, a: Attribution, o: string): Promise<EstadoAutonomia> {
    const s = await this.cargar(ctx);
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.politicaEstablecida, { nivel }, a, o);
  }

  /** Cambia el nivel. SOEC NO puede elevar su propia autonomía; sólo un humano puede subirla. */
  async cambiarNivel(ctx: RequestContext, nuevoNivel: number, solicitante: Solicitante, a: Attribution, o: string): Promise<EstadoAutonomia> {
    const s = await this.cargar(ctx);
    if (solicitante === 'soec' && nuevoNivel > s.nivel) {
      throw new AutonomiaNoAutoElevableError('SOEC no puede elevar su propio nivel de autonomía; requiere decisión humana');
    }
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.nivelCambiado, { nivel: nuevoNivel, solicitante }, a, o);
  }

  /** Activa el modo seguro (PAUSA). Prevalece sobre cualquier aprobación previa. */
  async pausar(ctx: RequestContext, motivo: string, a: Attribution, o: string): Promise<EstadoAutonomia> {
    const s = await this.cargar(ctx);
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.pausado, { motivo, actor: String(ctx.actor) }, a, o);
  }

  /** Reanuda. Exige un actor humano identificado y deja traza (quién y por qué). */
  async reanudar(ctx: RequestContext, actorHumano: string, motivo: string, a: Attribution, o: string): Promise<EstadoAutonomia> {
    if (!actorHumano.trim()) throw new ReanudacionSinActorHumanoError('reanudar exige un actor humano que responda por la decisión');
    const s = await this.cargar(ctx);
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.reanudado, { actorHumano, motivo, en: o }, a, o);
  }

  /** Otorga una autorización humana para una acción concreta (o '*') con vencimiento. */
  async otorgarAutorizacion(ctx: RequestContext, cmd: OtorgarAutorizacionCmd, a: Attribution, o: string): Promise<EstadoAutonomia> {
    if (!cmd.actorHumano.trim()) throw new AutonomiaInvalidaError('una autorización requiere un actor humano');
    const org = this.org(ctx);
    const s = await this.cargar(ctx);
    const autorizacion: Autorizacion = {
      id: `auth:${org}:${cmd.accion}:${cmd.entidadRef}:${s.autorizaciones.length + 1}`,
      organizacionId: org,
      accion: cmd.accion,
      entidadRef: cmd.entidadRef,
      actorHumano: cmd.actorHumano,
      otorgadaEn: cmd.otorgadaEn,
      expiraEn: cmd.expiraEn,
    };
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.autorizado, autorizacion, a, o);
  }

  /** Consulta (no muta): ¿puede ejecutarse esta acción ahora? */
  async puedeEjecutar(ctx: RequestContext, accion: AccionGobernada, entidadRef: string, ahora: string): Promise<Veredicto> {
    const s = await this.cargar(ctx);
    return puedeEjecutar(s, this.org(ctx), accion, entidadRef, ahora);
  }

  /** Inicia una acción en vuelo. Rechaza si no está autorizada; sella la pausaSeq del inicio. */
  async iniciarAccion(ctx: RequestContext, accionId: string, accion: AccionGobernada, entidadRef: string, ahora: string, a: Attribution, o: string): Promise<EstadoAutonomia> {
    const s = await this.cargar(ctx);
    const v = puedeEjecutar(s, this.org(ctx), accion, entidadRef, ahora);
    if (!v.permitida) throw new AutonomiaInvalidaError(`no se puede iniciar ${accion}: ${v.motivo}`);
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.accionIniciada, { accionId, accion, entidadRef, pausaSeqAlIniciar: s.pausaSeq, finalizada: false }, a, o);
  }

  /** Consulta (no muta): ¿puede continuar una acción ya iniciada? */
  async puedeContinuar(ctx: RequestContext, accionId: string): Promise<Veredicto> {
    const s = await this.cargar(ctx);
    return puedeContinuar(s, accionId);
  }

  /** Finaliza una acción en vuelo (sólo si puede continuar). */
  async finalizarAccion(ctx: RequestContext, accionId: string, a: Attribution, o: string): Promise<EstadoAutonomia> {
    const s = await this.cargar(ctx);
    const v = puedeContinuar(s, accionId);
    if (!v.permitida) throw new AutonomiaInvalidaError(`no se puede finalizar ${accionId}: ${v.motivo}`);
    return this.append(ctx, s.version, EVENTOS_AUTONOMIA.accionFinalizada, { accionId }, a, o);
  }
}
