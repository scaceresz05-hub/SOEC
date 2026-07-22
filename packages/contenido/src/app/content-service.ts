/**
 * Orquestador de la Fábrica Autónoma de Contenido (F2-CONT-01 §16). Toma una
 * actividad de marketing bloqueada por `contenido_faltante` y produce un paquete
 * publicable versionado; si queda `listo`, lo entrega a la actividad mediante el
 * CONTRATO PÚBLICO de marketing (`prepararActividad`), que la transiciona a
 * `autorizable`. La ejecución sigue pasando por el plano operacional (simulada):
 * la fábrica no publica, no se autoriza, no gasta presupuesto real. Una pieza
 * inválida nunca desbloquea la actividad ni alcanza ejecución.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { PolicyService, versionVigente } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import type { ContenidoBrief, EtapaEmbudo } from '../domain/brief';
import { esCanal, type Canal } from '../domain/canales';
import {
  EVENTOS_PAQ,
  type PaqueteState,
  type PayloadProducido,
  paqueteStreamId,
  reconstruirPaquete,
} from '../domain/paquete';
import { ComandoContenidoInvalidoError, PaqueteNoEncontradoError } from '../domain/errors';
import type { ProveedorGenerativo } from '../domain/generative';
import { promptRef } from '../domain/prompts';
import { BriefService } from './brief-service';
import { FactoryService } from './factory-service';
import { MarcaService } from './marca-service';
import { PromptService } from './prompt-service';

export interface PrepararContenidoCmd {
  readonly planId: string;
  readonly actividadId: string;
  readonly marcaId: string;
  readonly promptPiezaId: string;
  readonly promptAdaptId: string;
  /** Canales adicionales para producir adaptaciones multicanal desde una misma pieza. */
  readonly canalesAdicionales?: readonly Canal[];
  readonly ganchosPromocionales?: Readonly<Record<string, string>>;
  readonly attribution: Attribution;
  readonly occurredAt: string;
}

export interface ResultadoPreparacion {
  readonly paquete: PaqueteState;
  readonly actividadDesbloqueada: boolean;
  readonly motivo: string;
}

export class ContentService {
  private readonly marcas: MarcaService;
  private readonly prompts: PromptService;
  private readonly briefs: BriefService;
  private readonly factory: FactoryService;
  private readonly objetivos: ObjectiveService;
  private readonly planning: PlanningService;

  constructor(
    private readonly store: EventStore,
    provider: ProveedorGenerativo,
    planning: PlanningService,
  ) {
    this.marcas = new MarcaService(store);
    this.prompts = new PromptService(store);
    this.briefs = new BriefService(store);
    this.factory = new FactoryService(provider);
    this.objetivos = new ObjectiveService(store);
    this.planning = planning;
  }

  cargarPaquete(ctx: RequestContext, paqueteId: string): Promise<PaqueteState> {
    return this.store.readStream(ctx, paqueteStreamId(paqueteId)).then((e) => reconstruirPaquete(paqueteId, ctx.organizationId, e));
  }

  private input(type: string, payload: unknown, attribution: Attribution, occurredAt: string): EventInput {
    return { type, payload, attribution, occurredAt };
  }

  private etapa(objetivoMarketing: string): EtapaEmbudo {
    const t = objetivoMarketing.toLowerCase();
    if (t.includes('lead') || t.includes('cotiz')) return 'conversion';
    if (t.includes('fidel')) return 'fidelizacion';
    return 'consideracion';
  }

  async prepararContenidoParaActividad(ctx: RequestContext, cmd: PrepararContenidoCmd): Promise<ResultadoPreparacion> {
    const plan = await this.planning.cargar(ctx, cmd.planId);
    if (!plan.existe) throw new ComandoContenidoInvalidoError(`El plan '${cmd.planId}' no existe`);
    const actividad = plan.actividades[cmd.actividadId];
    if (!actividad) throw new ComandoContenidoInvalidoError(`La actividad '${cmd.actividadId}' no existe en el plan`);

    const paqueteId = `${cmd.planId}--${cmd.actividadId}`;
    const existente = await this.cargarPaquete(ctx, paqueteId);
    if (existente.existe) {
      return { paquete: existente, actividadDesbloqueada: actividad.estado !== 'bloqueada', motivo: 'ya_producido' };
    }

    const objetivo = await this.objetivos.cargar(ctx, plan.objetivoRef);
    const oc = objetivo.contenido;
    if (!oc) throw new ComandoContenidoInvalidoError('El objetivo del plan no está disponible');
    const pv = versionVigente(await new PolicyService(this.store).cargar(ctx, plan.policyId));
    const marca = await this.marcas.vigente(ctx, cmd.marcaId);
    const promptPieza = await this.prompts.vigente(ctx, cmd.promptPiezaId);
    const promptAdapt = await this.prompts.vigente(ctx, cmd.promptAdaptId);
    if (!promptPieza || !promptAdapt) throw new ComandoContenidoInvalidoError('Faltan plantillas de prompt vigentes');

    const campania = plan.campanias.find((c) => c.id === actividad.campaniaId);
    const brief: ContenidoBrief = {
      organizationId: String(ctx.organizationId),
      marcaId: cmd.marcaId,
      objetivoComercial: oc.objetivoComercial,
      objetivoMarketing: oc.objetivoMarketing,
      iniciativaId: campania?.iniciativaId ?? '',
      campaniaId: actividad.campaniaId,
      planId: cmd.planId,
      actividadId: cmd.actividadId,
      audiencia: oc.audiencia,
      segmento: oc.segmento,
      etapaEmbudo: this.etapa(oc.objetivoMarketing),
      canalDestino: actividad.canal,
      proposito: `producir contenido de ${actividad.canal} para ${oc.objetivoMarketing}`,
      mensajePrincipal: oc.propuestaValor,
      propuestaValor: oc.propuestaValor,
      productoServicio: oc.producto,
      problemaCliente: `${oc.audiencia} necesita ${oc.producto}`,
      llamadaAccion: 'Solicita una cotización',
      tono: marca?.tono ?? 'cercano y profesional',
      idioma: oc.idioma,
      territorio: oc.territorio,
      restricciones: oc.restricciones,
      afirmacionesPermitidas: [],
      afirmacionesProhibidas: pv?.afirmacionesProhibidas ?? [],
      requisitosLegales: oc.restricciones,
      fuentesDisponibles: [`objetivo:${plan.objetivoRef}`],
      fechaObjetivo: actividad.fechaProgramada,
    };

    const briefId = `brief--${paqueteId}`;
    const briefState = await this.briefs.crear(ctx, briefId, brief, cmd.attribution, cmd.occurredAt);

    // Brief incompleto → no se inventa el dato; paquete incompleto con faltantes visibles.
    if (briefState.estado === 'incompleto' || !esCanal(actividad.canal)) {
      const motivoInc = briefState.estado === 'incompleto' ? `brief_incompleto: ${briefState.faltantes.join(', ')}` : `canal_no_soportado: ${actividad.canal}`;
      const payload = this.payloadIncompleto(paqueteId, briefId, cmd, actividad.campaniaId, actividad.canal, briefState.faltantes);
      await this.store.append(ctx, paqueteStreamId(paqueteId), existente.version, [this.input(EVENTOS_PAQ.producido, payload, cmd.attribution, cmd.occurredAt)]);
      return { paquete: await this.cargarPaquete(ctx, paqueteId), actividadDesbloqueada: false, motivo: motivoInc };
    }

    const canal = actividad.canal as Canal;
    const canalesDestino: Canal[] = [canal, ...(cmd.canalesAdicionales ?? []).filter((c) => c !== canal)];

    const payload = await this.factory.producir(ctx, {
      paqueteId,
      briefId,
      marcaId: cmd.marcaId,
      planId: cmd.planId,
      campaniaId: actividad.campaniaId,
      actividadId: cmd.actividadId,
      brief,
      marca,
      afirmacionesProhibidas: pv?.afirmacionesProhibidas ?? [],
      canalesAutorizados: pv?.canalesAutorizados ?? [],
      canalesDestino,
      promptPiezaRef: promptRef(cmd.promptPiezaId, promptPieza.version, promptPieza.huella),
      promptAdaptRef: promptRef(cmd.promptAdaptId, promptAdapt.version, promptAdapt.huella),
      ...(cmd.ganchosPromocionales ? { ganchosPromocionales: cmd.ganchosPromocionales } : {}),
      occurredAt: cmd.occurredAt,
    });
    await this.store.append(ctx, paqueteStreamId(paqueteId), existente.version, [this.input(EVENTOS_PAQ.producido, payload, cmd.attribution, cmd.occurredAt)]);

    // Solo un paquete LISTO desbloquea, y solo si la actividad está bloqueada por contenido_faltante.
    const puedeEntregar = payload.resultado === 'listo' && actividad.estado === 'bloqueada' && actividad.motivoBloqueo === 'contenido_faltante';
    if (!puedeEntregar) {
      const motivo = payload.resultado !== 'listo' ? `paquete_${payload.resultado}` : `actividad_no_preparable: ${actividad.motivoBloqueo ?? actividad.estado}`;
      return { paquete: await this.cargarPaquete(ctx, paqueteId), actividadDesbloqueada: false, motivo };
    }

    const principal = payload.adaptaciones.find((a) => a.canal === canal);
    const contenidoEjecutable = principal ? `${principal.titulo} ${principal.cuerpo} ${principal.llamadaAccion}`.trim() : payload.pieza.cuerpo;
    await this.planning.prepararActividad(ctx, cmd.planId, cmd.actividadId, contenidoEjecutable, paqueteId, cmd.attribution, cmd.occurredAt);
    await this.store.append(ctx, paqueteStreamId(paqueteId), 1, [this.input(EVENTOS_PAQ.entregado, { actividadRef: cmd.actividadId }, cmd.attribution, cmd.occurredAt)]);

    return { paquete: await this.cargarPaquete(ctx, paqueteId), actividadDesbloqueada: true, motivo: 'entregado' };
  }

  /** Registra en el paquete el resultado de la ejecución simulada del plano operacional. */
  async registrarEjecucion(
    ctx: RequestContext,
    paqueteId: string,
    r: { permitida: boolean; resultado: string; executionRef: string; attribution: Attribution; occurredAt: string },
  ): Promise<PaqueteState> {
    const paquete = await this.cargarPaquete(ctx, paqueteId);
    if (!paquete.existe) throw new PaqueteNoEncontradoError(`El paquete '${paqueteId}' no existe`);
    const nuevoEstado = r.permitida ? 'verificado' : 'fallido';
    await this.store.append(ctx, paqueteStreamId(paqueteId), paquete.version, [
      this.input(EVENTOS_PAQ.ejecutado, { executionRef: r.executionRef, permitida: r.permitida, resultado: r.resultado, nuevoEstado }, r.attribution, r.occurredAt),
    ]);
    return this.cargarPaquete(ctx, paqueteId);
  }

  private payloadIncompleto(paqueteId: string, briefId: string, cmd: PrepararContenidoCmd, campaniaId: string, canal: string, faltantes: readonly string[]): PayloadProducido {
    return {
      briefRef: briefId,
      marcaRef: cmd.marcaId,
      canal,
      planRef: cmd.planId,
      campaniaRef: campaniaId,
      actividadRef: cmd.actividadId,
      pieza: {
        version: 1,
        tituloInterno: '',
        tesis: '',
        estructura: [],
        mensaje: '',
        cuerpo: '',
        llamadaAccion: '',
        hechosUtilizados: [],
        afirmaciones: [],
        referencias: [],
        supuestos: [],
        advertencias: [],
        idioma: '',
        procedencia: '',
        estado: 'rechazada',
      },
      historialPiezas: [],
      adaptaciones: [],
      activos: [],
      revisiones: [],
      hallazgos: faltantes.map((f) => ({ codigo: 'brief.faltante', severidad: 'critico' as const, ubicacion: `brief:${briefId}`, descripcion: `Falta información obligatoria: ${f}`, evidencia: f, accionPosible: 'completar el brief', bloqueante: true })),
      resultado: 'incompleto',
      huella: '',
      costoProduccion: 0,
      estado: 'incompleto',
    };
  }
}
