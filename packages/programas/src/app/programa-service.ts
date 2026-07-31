/**
 * Servicio de configuración de Programas. Crea programas y, al vincular campañas/contenido,
 * REUTILIZA los servicios A–J (decisiones-mkt, campanias, contenido-gobernado) — no los duplica.
 * Ids scopeados por programa (`<programaId>-d1`, `-c1`, `-c1-p1`) para evitar la colisión de ids
 * fijos del demo. Todo presupuesto es SIMULADO. Event-sourced.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { DecisionMktService, type EntradaDecision } from '@soec/decisiones-mkt';
import { CampaniaService, POLITICA_CAMPANIA_CONSERVADORA } from '@soec/campanias';
import { ContenidoGobernadoService, type EntradaContenido } from '@soec/contenido-gobernado';
import {
  type CampaniaRef,
  type Hipotesis,
  type Programa,
  type Segmento,
  EVENTOS_PROGRAMA,
  presupuestoComprometido,
  programaEjecutable,
  programaStreamId,
  reconstruirPrograma,
} from '../domain/programa';
import { EVENTOS_PROGINDICE, type EntradaPrograma, type ProgIndice, progIndiceStreamId, reconstruirProgIndice } from '../domain/indices';
import { ProgramaInvalidoError } from '../domain/errors';

export interface EntradaCrearPrograma {
  readonly nombre: string;
  readonly objetivoPrincipal: string;
  readonly objetivosSecundarios?: readonly string[];
  readonly presupuestoTotalSimulado: number;
  readonly moneda?: string;
  readonly fechaInicioHipotetica?: string;
  readonly fechaFinHipotetica?: string;
}

export interface EntradaVincularCampania {
  readonly nombre: string;
  readonly segmentoId: string;
  readonly hipotesisId: string;
  readonly publico: string;
  readonly propuesta: string;
  readonly mensaje: string;
  readonly canal: string;
  readonly presupuestoSimulado: number;
  readonly duracionHipotetica: string;
  readonly calendario?: string;
}

export class ProgramaService {
  private readonly decisiones: DecisionMktService;
  private readonly campanias: CampaniaService;
  private readonly contenidos: ContenidoGobernadoService;

  constructor(private readonly store: EventStore) {
    this.decisiones = new DecisionMktService(store);
    this.campanias = new CampaniaService(store);
    this.contenidos = new ContenidoGobernadoService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, programaId: string): Promise<Programa> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, programaStreamId(org, programaId)).then((e) => reconstruirPrograma(org, programaId, e));
  }

  async listar(ctx: RequestContext): Promise<ProgIndice> {
    return reconstruirProgIndice(await this.store.readStream(ctx, progIndiceStreamId(this.org(ctx))));
  }

  private append(ctx: RequestContext, programaId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<{ version: number }> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, programaStreamId(this.org(ctx), programaId), version, [input]);
  }

  /** Crea el programa (idempotente) y lo inscribe en el índice de programas de la organización. */
  async crear(ctx: RequestContext, programaId: string, entrada: EntradaCrearPrograma, a: Attribution, o: string): Promise<Programa> {
    if (!entrada.nombre.trim()) throw new ProgramaInvalidoError('el programa requiere un nombre');
    if (!(entrada.presupuestoTotalSimulado >= 0)) throw new ProgramaInvalidoError('presupuesto total inválido');
    const existente = await this.cargar(ctx, programaId);
    if (existente.existe) return existente;
    await this.append(ctx, programaId, existente.version, EVENTOS_PROGRAMA.creado, {
      nombre: entrada.nombre,
      objetivoPrincipal: entrada.objetivoPrincipal,
      objetivosSecundarios: entrada.objetivosSecundarios ?? [],
      presupuestoTotalSimulado: entrada.presupuestoTotalSimulado,
      moneda: entrada.moneda ?? 'CLP',
      fechaInicioHipotetica: entrada.fechaInicioHipotetica ?? '',
      fechaFinHipotetica: entrada.fechaFinHipotetica ?? '',
    }, a, o);
    await this.registrarEnIndice(ctx, programaId, entrada.nombre, a, o);
    return this.cargar(ctx, programaId);
  }

  async agregarSegmento(ctx: RequestContext, programaId: string, segmento: Segmento, a: Attribution, o: string): Promise<Programa> {
    const p = await this.exigirPrograma(ctx, programaId);
    if (p.segmentos.some((s) => s.id === segmento.id)) {
      throw new ProgramaInvalidoError(`el segmento ya existe en el programa: ${segmento.id}`);
    }
    await this.append(ctx, programaId, p.version, EVENTOS_PROGRAMA.segmentoAgregado, segmento, a, o);
    return this.cargar(ctx, programaId);
  }

  async agregarHipotesis(ctx: RequestContext, programaId: string, hipotesis: Hipotesis, a: Attribution, o: string): Promise<Programa> {
    const p = await this.exigirPrograma(ctx, programaId);
    if (p.hipotesis.some((h) => h.id === hipotesis.id)) {
      throw new ProgramaInvalidoError(`la hipótesis ya existe en el programa: ${hipotesis.id}`);
    }
    if (!p.segmentos.some((s) => s.id === hipotesis.segmentoId)) {
      throw new ProgramaInvalidoError(`la hipótesis referencia un segmento inexistente: ${hipotesis.segmentoId}`);
    }
    await this.append(ctx, programaId, p.version, EVENTOS_PROGRAMA.hipotesisAgregada, hipotesis, a, o);
    return this.cargar(ctx, programaId);
  }

  /**
   * Vincula una campaña al programa: crea una decisión APROBADA y una campaña gobernada
   * (reutilizando A–J) con ids scopeados por programa, y registra la referencia.
   */
  async vincularCampania(ctx: RequestContext, programaId: string, cmd: EntradaVincularCampania, a: Attribution, o: string): Promise<Programa> {
    const p = await this.exigirPrograma(ctx, programaId);
    if (!p.segmentos.some((s) => s.id === cmd.segmentoId)) throw new ProgramaInvalidoError(`segmento inexistente: ${cmd.segmentoId}`);
    if (!p.hipotesis.some((h) => h.id === cmd.hipotesisId)) throw new ProgramaInvalidoError(`hipótesis inexistente: ${cmd.hipotesisId}`);
    if (!(cmd.presupuestoSimulado > 0)) throw new ProgramaInvalidoError('el presupuesto simulado de la campaña debe ser positivo');
    if (presupuestoComprometido(p) + cmd.presupuestoSimulado > p.presupuestoTotalSimulado) {
      throw new ProgramaInvalidoError('el presupuesto de la campaña excede el total simulado del programa');
    }

    const org = this.org(ctx);
    const n = p.campanias.length + 1;
    const decisionId = `${programaId}-d${n}`;
    const campaignId = `${programaId}-c${n}`;

    // Decisión APROBADA derivada de la hipótesis (reutiliza @soec/decisiones-mkt).
    await this.decisiones.crear(ctx, decisionId, this.decisionDesde(org, cmd, p.objetivoPrincipal), a, o);
    await this.decisiones.transicionar(ctx, decisionId, 'PENDIENTE_APROBACION', a, o);
    await this.decisiones.transicionar(ctx, decisionId, 'APROBADA', a, o);

    // Campaña gobernada (reutiliza @soec/campanias).
    await this.campanias.crearDesdeDecision(ctx, campaignId, {
      organizacionId: org,
      decisionId,
      objetivo: p.objetivoPrincipal,
      publico: cmd.publico,
      propuesta: cmd.propuesta,
      mensaje: cmd.mensaje,
      canal: cmd.canal,
      calendario: cmd.calendario ?? p.fechaInicioHipotetica,
      presupuesto: { monto: cmd.presupuestoSimulado, moneda: p.moneda },
      hipotesis: [cmd.mensaje],
      metricas: ['leads_simulados/mes'],
      criterioExito: 'señal simulada positiva',
      criterioPausa: 'CPL simulado > umbral',
    }, POLITICA_CAMPANIA_CONSERVADORA, a, o);

    const ref: CampaniaRef = {
      campaignId,
      segmentoId: cmd.segmentoId,
      hipotesisId: cmd.hipotesisId,
      decisionId,
      presupuestoSimulado: cmd.presupuestoSimulado,
      duracionHipotetica: cmd.duracionHipotetica,
      contenidoIds: [],
    };
    await this.append(ctx, programaId, p.version, EVENTOS_PROGRAMA.campaniaVinculada, ref, a, o);
    return this.cargar(ctx, programaId);
  }

  /** Vincula una pieza de contenido gobernado a una campaña del programa (reutiliza A–J). */
  async vincularContenido(ctx: RequestContext, programaId: string, campaignId: string, entrada: EntradaContenido, a: Attribution, o: string): Promise<Programa> {
    const p = await this.exigirPrograma(ctx, programaId);
    const ref = p.campanias.find((c) => c.campaignId === campaignId);
    if (!ref) throw new ProgramaInvalidoError(`la campaña ${campaignId} no pertenece al programa`);
    const campania = await this.campanias.cargar(ctx, campaignId);
    if (!campania.existe) throw new ProgramaInvalidoError(`la campaña ${campaignId} no existe`);
    const contenidoId = `${campaignId}-p${ref.contenidoIds.length + 1}`;
    await this.contenidos.derivarDeCampania(ctx, contenidoId, campania, entrada, a, o);
    await this.append(ctx, programaId, p.version, EVENTOS_PROGRAMA.contenidoVinculado, { campaignId, contenidoId }, a, o);
    return this.cargar(ctx, programaId);
  }

  /** Marca el programa como LISTO si su configuración permite ejecutar el ciclo. */
  async marcarListo(ctx: RequestContext, programaId: string, a: Attribution, o: string): Promise<Programa> {
    const p = await this.exigirPrograma(ctx, programaId);
    const ej = programaEjecutable(p);
    if (!ej.ok) throw new ProgramaInvalidoError(`el programa no está completo: ${ej.motivo}`);
    if (p.estado === 'BORRADOR') await this.append(ctx, programaId, p.version, EVENTOS_PROGRAMA.transicionado, { estado: 'LISTO' }, a, o);
    return this.cargar(ctx, programaId);
  }

  private async exigirPrograma(ctx: RequestContext, programaId: string): Promise<Programa> {
    const p = await this.cargar(ctx, programaId);
    if (!p.existe) throw new ProgramaInvalidoError(`el programa ${programaId} no existe`);
    return p;
  }

  private async registrarEnIndice(ctx: RequestContext, programaId: string, nombre: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirProgIndice(await this.store.readStream(ctx, progIndiceStreamId(org)));
    if (idx.programas.some((x) => x.programaId === programaId)) return;
    const entrada: EntradaPrograma = { programaId, nombre };
    const input: EventInput = { type: EVENTOS_PROGINDICE.registrado, payload: entrada, attribution: a, occurredAt: o };
    await this.store.append(ctx, progIndiceStreamId(org), idx.version, [input]);
  }

  /** Construye una EntradaDecision evaluable a partir de la intención de campaña. */
  private decisionDesde(org: string, cmd: EntradaVincularCampania, objetivoPrograma: string): EntradaDecision {
    return {
      organizacionId: org,
      objetivo: objetivoPrograma,
      contexto: `segmento ${cmd.segmentoId}; hipótesis ${cmd.hipotesisId}`,
      hechos: [{ enunciado: cmd.propuesta, origen: 'DATO_DECLARADO_POR_USUARIO', fuente: 'configuración del programa', evidenciaId: null }],
      fuentes: ['configuración del programa'],
      faltantesObligatorios: [],
      inferencias: [],
      hipotesis: [{ id: cmd.hipotesisId, enunciado: cmd.mensaje, tipo: 'HIPOTESIS' }],
      alternativas: [
        { id: 'a1', descripcion: cmd.propuesta, elegida: true, razonDescarte: null },
        { id: 'a2', descripcion: 'no accionar este segmento', elegida: false, razonDescarte: 'se prioriza la hipótesis configurada' },
      ],
      justificacion: `campaña "${cmd.nombre}" para el segmento ${cmd.segmentoId}`,
      riesgos: ['estacionalidad simulada'],
      confianza: 'MEDIA',
      criterioExito: 'señal simulada positiva',
      criterioFracaso: 'sin señal a 30 días simulados',
      aprobacionRequerida: true,
      nivelAutonomia: 1,
      aprendizajeQueLaCambio: null,
    };
  }
}
