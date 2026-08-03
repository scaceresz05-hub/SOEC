/**
 * @soec/motor-creativo · aplicación · PIPELINE CREATIVO gobernado (M6), en DOS fases.
 *
 * FASE 1 `componer`: LecturaConocimiento(M5) → Contexto → Brief → Territorio → Estrategia (gobernada) →
 * Mensajes → Validación autoritativa → Pieza (fábrica canónica de @soec/contenido, reutilizada) →
 * Variante A/B. Deja todo en PENDIENTE_APROBACION. NO aprueba (la aprobación es humana y externa) y NO
 * calendariza.
 *
 * FASE 2 `calendarizar`: se ejecuta DESPUÉS de que un humano registró la aprobación (AprobacionService).
 * Verifica, por el gate ÚNICO `evaluarVigenciaCreativa`, que la pieza sigue VIGENTE respecto de M5 y que
 * la aprobación de la pieza (por versión exacta) y de la variante están vigentes; solo entonces crea la
 * entrada de calendario. Idempotente y reparable. NUNCA publica ni programa efectivamente.
 *
 * Se abstiene (primera clase) ante el primer gate que falle; nunca produce artefactos aguas abajo de una
 * validación fallida. Multi-tenant por construcción (cada agregado subyacente lo es).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import {
  EstrategiaCreativaArtefactoService,
  VariantesABService,
  CalendarioEditorialService,
  AprobacionService,
} from '@soec/estrategia-creativa';
import {
  BriefService,
  FactoryService,
  ProveedorGenerativoDeterminista,
  type Canal,
  type ContenidoBrief,
  type FormatoPieza,
  type PayloadGobernanzaCreativa,
  type PayloadProducido,
  type ProducirParams,
  type TrazaAfirmacion,
  EVENTOS_PAQ,
  paqueteStreamId,
  reconstruirPaquete,
} from '@soec/contenido';
import { MotorCreativoService } from './motor-creativo-service';
import { GobernanzaCreativaService } from './gobernanza-creativa-service';
import { type ResultadoCreativo, abstener, esPropuesta, proponer } from '../dominio/abstencion';
import type { MensajeCreativo } from '../dominio/mensaje';
import type { EntradaValidacionContenido } from '@soec/estrategia-creativa';
import { versionConocimiento } from '../dominio/vigencia';
import type { EstadoVigenciaCreativa } from '../dominio/vigencia-creativa';
import { contextoEvaluable, type RolConocimiento } from '../dominio/contexto-creativo';
import { EVENTOS_INDICE_PIEZAS, indicePiezasStreamId, reconstruirIndicePiezas } from '../dominio/indice-piezas';

/** Puerto de producción de pieza: la fábrica canónica de `@soec/contenido` por defecto; inyectable. */
export interface ProductorPieza {
  producir(ctx: RequestContext, p: ProducirParams): Promise<PayloadProducido>;
}

export interface EntradaPipeline {
  readonly contextoId: string;
  readonly roles: readonly { readonly rol: RolConocimiento; readonly afirmacionId: string }[];
  readonly briefId: string;
  readonly brief: ContenidoBrief;
  readonly territorioId: string;
  readonly estrategiaCreativaId: string;
  readonly mensajes: readonly MensajeCreativo[];
  readonly validacion: EntradaValidacionContenido;
  readonly paqueteId: string;
  readonly formato: FormatoPieza;
  readonly canal: Canal;
  readonly variante?: { readonly varianteId: string; readonly hipotesis: string; readonly elemento: 'gancho' | 'cta' | 'angulo' | 'formato' | 'longitud'; readonly diferencia: string; readonly constantes: readonly string[] };
  readonly calendario?: { readonly programaId: string; readonly entradaId: string; readonly fechaHora: string; readonly zonaHoraria: string; readonly objetivo: string; readonly segmento: string };
}

export type EstadoPlan = 'PENDIENTE_APROBACION' | 'CALENDARIZADO';

export interface PlanCreativo {
  readonly contextoId: string;
  readonly briefId: string;
  readonly territorioId: string;
  readonly estrategiaCreativaId: string;
  readonly paqueteId: string;
  /** Versión EXACTA de la pieza que debe aprobarse (una versión nueva no hereda aprobación). */
  readonly piezaVersionParaAprobar: number;
  readonly varianteId: string | null;
  readonly entradaCalendarioId: string | null;
  readonly estado: EstadoPlan;
  readonly vigencia: EstadoVigenciaCreativa;
  readonly resumen: string;
}

export class PipelineCreativoService {
  private readonly motor: MotorCreativoService;
  private readonly brief: BriefService;
  private readonly artefacto: EstrategiaCreativaArtefactoService;
  private readonly variantes: VariantesABService;
  private readonly calendario: CalendarioEditorialService;
  private readonly aprobacion: AprobacionService;
  private readonly gobernanza: GobernanzaCreativaService;
  private readonly factory: ProductorPieza;

  constructor(
    private readonly store: EventStore,
    private readonly conocimiento: LecturaConocimiento,
    deps?: { factory?: ProductorPieza },
  ) {
    this.motor = new MotorCreativoService(store, conocimiento);
    this.brief = new BriefService(store);
    this.artefacto = new EstrategiaCreativaArtefactoService(store);
    this.variantes = new VariantesABService(store);
    this.calendario = new CalendarioEditorialService(store);
    this.aprobacion = new AprobacionService(store);
    this.gobernanza = new GobernanzaCreativaService(store, conocimiento);
    this.factory = deps?.factory ?? new FactoryService(new ProveedorGenerativoDeterminista());
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  // ── FASE 1: componer (hasta PENDIENTE_APROBACION; nunca aprueba ni calendariza) ─────────────────
  async componer(ctx: RequestContext, e: EntradaPipeline, a: Attribution, o: string): Promise<ResultadoCreativo<PlanCreativo>> {
    const contexto = await this.motor.construirContexto(ctx, e.contextoId, e.roles, a, o);
    if ((await this.motor.verificarVigencia(ctx, e.contextoId, a, o)).length > 0) {
      return abstener('CONOCIMIENTO_OBSOLETO', { porQue: 'el contexto creativo está obsoleto respecto de M5', evidenciaUsada: [], queFalta: ['reconstruir el contexto'], queImpediriaConcluir: ['referencias de M5 cambiaron de versión'] });
    }
    const icp = contexto.referencias.find((r) => r.rol === 'ICP');
    if (!icp || icp.estado !== 'VERDADERO') return abstener('FALTA_AUDIENCIA', { porQue: 'sin ICP sostenido en M5', evidenciaUsada: [], queFalta: ['un ICP VERDADERO'], queImpediriaConcluir: ['audiencia no sostenida'] });
    const pv = contexto.referencias.find((r) => r.rol === 'PROPUESTA_VALOR');
    if (!pv || pv.estado !== 'VERDADERO') return abstener('FALTA_PROPUESTA_VALOR', { porQue: 'sin propuesta de valor sostenida en M5', evidenciaUsada: [], queFalta: ['una propuesta de valor VERDADERO'], queImpediriaConcluir: ['propuesta de valor no sostenida'] });
    const objr = contexto.referencias.find((r) => r.rol === 'OBJETIVO');
    if (objr && objr.estado === 'NO_EVALUABLE') return abstener('OBJETIVO_NO_EVALUABLE', { porQue: 'objetivo no evaluable en M5', evidenciaUsada: [], queFalta: ['sostener el objetivo'], queImpediriaConcluir: ['objetivo no evaluable'] });
    if (!contextoEvaluable(contexto)) {
      return abstener('EVIDENCIA_INSUFICIENTE', { porQue: 'contexto no evaluable', evidenciaUsada: contexto.referencias.map((r) => r.afirmacionId), queFalta: [...contexto.faltantes], queImpediriaConcluir: ['faltan roles sostenidos en M5'] });
    }
    const refsM5 = contexto.referencias.map((r) => ({ afirmacionId: r.afirmacionId, version: r.version }));
    const versionesEsperadas: Record<string, number> = {};
    for (const r of contexto.referencias) versionesEsperadas[r.afirmacionId] = r.version;

    // Brief evaluable con gobernanza M5 (inmutable por versión).
    const briefGobernado: ContenidoBrief = {
      ...e.brief, contextoCreativoId: e.contextoId, referenciasM5: refsM5, informacionFaltante: contexto.faltantes,
      estadoEpistemico: 'VERDADERO', explicacion: 'brief derivado de un contexto vigente y sostenido en M5', versionConocimiento: versionConocimiento(refsM5), vigencia: 'VIGENTE',
    };
    const briefSt = await this.brief.crear(ctx, e.briefId, briefGobernado, a, o);
    if (briefSt.estado === 'incompleto') return abstener('EVIDENCIA_INSUFICIENTE', { porQue: 'brief incompleto', evidenciaUsada: [], queFalta: [...briefSt.faltantes], queImpediriaConcluir: ['brief incompleto'] });

    const rt = await this.motor.evaluarTerritorio(ctx, e.territorioId);
    if (!esPropuesta(rt)) return rt as ResultadoCreativo<PlanCreativo>;

    const art = await this.artefacto.cargar(ctx, e.estrategiaCreativaId);
    if (!art.existe) return abstener('SIN_AFIRMACION_PERMITIDA', { porQue: 'no existe la estrategia creativa a gobernar', evidenciaUsada: [], queFalta: ['registrar la estrategia'], queImpediriaConcluir: ['estrategia inexistente'] });
    await this.artefacto.vincularGobernanzaM5(ctx, e.estrategiaCreativaId, { afirmacionesProhibidas: e.brief.afirmacionesProhibidas, referenciasM5: refsM5, estadoGobernanza: 'VIGENTE', contextoCreativoId: e.contextoId }, a, o);

    const veredicto = await this.motor.validarMensajesAutoritativo(ctx, e.validacion, e.mensajes, versionesEsperadas);
    if (!veredicto.autoriza) {
      return abstener('SIN_AFIRMACION_PERMITIDA', { porQue: 'la validación creativa autoritativa no autorizó el contenido', evidenciaUsada: e.mensajes.map((m) => m.afirmacionRespaldoId ?? '').filter(Boolean), queFalta: ['respaldar cada afirmación con conocimiento VERDADERO y vigente en M5'], queImpediriaConcluir: [...veredicto.razones] });
    }

    const paq = await this.producirPieza(ctx, e, briefGobernado, a, o);
    if (paq.estado !== 'listo') return abstener('EVIDENCIA_INSUFICIENTE', { porQue: `la pieza no quedó lista (${paq.estado})`, evidenciaUsada: [], queFalta: ['contenido válido para la pieza'], queImpediriaConcluir: [`estado de paquete: ${paq.estado}`] });
    await this.gobernarPieza(ctx, e, refsM5, a, o);
    await this.registrarPiezaEnIndice(ctx, e.paqueteId, a, o);

    let varianteId: string | null = null;
    if (e.variante) {
      await this.variantes.agregarVariante(ctx, e.paqueteId, { varianteId: e.variante.varianteId, hipotesisQuePrueba: e.variante.hipotesis, elementoModificado: e.variante.elemento, diferenciaControlada: e.variante.diferencia, elementosConstantes: e.variante.constantes, criterioExito: 'mayor CTR (KPI futuro, sin métricas reales)' }, a, o);
      varianteId = e.variante.varianteId;
    }

    const piezaVersion = (await this.cargarPaquete(ctx, e.paqueteId)).version;
    return proponer({
      contextoId: e.contextoId, briefId: e.briefId, territorioId: e.territorioId, estrategiaCreativaId: e.estrategiaCreativaId, paqueteId: e.paqueteId,
      piezaVersionParaAprobar: piezaVersion, varianteId, entradaCalendarioId: null,
      estado: 'PENDIENTE_APROBACION', vigencia: 'VIGENTE',
      resumen: `pieza gobernada, trazable a ${refsM5.length} afirmaciones de M5; a la espera de aprobación humana (no publica ni programa)`,
    });
  }

  // ── FASE 2: calendarizar (SOLO tras aprobación humana; gate único de vigencia + aprobación) ──────
  async calendarizar(ctx: RequestContext, e: EntradaPipeline, a: Attribution, o: string): Promise<ResultadoCreativo<PlanCreativo>> {
    if (!e.calendario) return abstener('EVIDENCIA_INSUFICIENTE', { porQue: 'falta la especificación de calendario', evidenciaUsada: [], queFalta: ['datos de calendario'], queImpediriaConcluir: ['sin calendario que poblar'] });
    const paq = await this.cargarPaquete(ctx, e.paqueteId);
    if (!paq.existe || !paq.pieza) return abstener('EVIDENCIA_INSUFICIENTE', { porQue: 'la pieza no existe', evidenciaUsada: [], queFalta: ['componer la pieza primero'], queImpediriaConcluir: ['pieza inexistente'] });

    // Gate ÚNICO de vigencia (deriva y materializa si quedó obsoleta).
    const refsM5 = (paq.pieza.referenciasM5 ?? []).map((r) => ({ afirmacionId: r.afirmacionId, version: r.version }));
    const dictamen = await this.gobernanza.evaluarVigenciaCreativa(ctx, refsM5, { estrategiaCreativaId: e.estrategiaCreativaId, paqueteId: e.paqueteId }, a, o);
    if (dictamen.estado !== 'VIGENTE') {
      return abstener('CONOCIMIENTO_OBSOLETO', { porQue: `la pieza no está vigente (${dictamen.estado}); no puede calendarizarse`, evidenciaUsada: [], queFalta: ['recomponer con el conocimiento vigente de M5'], queImpediriaConcluir: [dictamen.motivo] });
    }

    // Aprobación de la pieza por versión EXACTA (una versión nueva no hereda aprobación).
    const piezaVersion = paq.version;
    if (!(await this.aprobacion.estaAprobada(ctx, 'PIEZA', e.paqueteId, piezaVersion))) {
      return abstener('VIOLA_RESTRICCIONES', { porQue: 'la pieza no tiene aprobación humana vigente para su versión actual', evidenciaUsada: [], queFalta: [`aprobación humana de la pieza ${e.paqueteId} v${piezaVersion}`], queImpediriaConcluir: ['pieza no aprobada / aprobación de otra versión'] });
    }
    if (e.variante && !(await this.aprobacion.aprobadaVigente(ctx, 'VARIANTE', e.variante.varianteId))) {
      return abstener('VIOLA_RESTRICCIONES', { porQue: 'la variante no tiene aprobación vigente', evidenciaUsada: [], queFalta: [`aprobación de la variante ${e.variante.varianteId}`], queImpediriaConcluir: ['variante no aprobada'] });
    }

    // Solo aquí se crea la entrada de calendario (idempotente). NO se programa (eso lo hará M7).
    await this.calendario.crear(ctx, e.calendario.programaId, e.calendario.zonaHoraria, a, o);
    await this.calendario.agregarEntrada(ctx, e.calendario.programaId, { entradaId: e.calendario.entradaId, fechaHora: e.calendario.fechaHora, canal: e.canal, piezaId: e.paqueteId, ...(e.variante ? { varianteId: e.variante.varianteId } : {}), objetivo: e.calendario.objetivo, segmento: e.calendario.segmento }, a, o);

    return proponer({
      contextoId: e.contextoId, briefId: e.briefId, territorioId: e.territorioId, estrategiaCreativaId: e.estrategiaCreativaId, paqueteId: e.paqueteId,
      piezaVersionParaAprobar: piezaVersion, varianteId: e.variante?.varianteId ?? null, entradaCalendarioId: e.calendario.entradaId,
      estado: 'CALENDARIZADO', vigencia: 'VIGENTE',
      resumen: `pieza aprobada y vigente, entrada de calendario creada en BORRADOR (M7 programará/ejecutará)`,
    });
  }

  private cargarPaquete(ctx: RequestContext, paqueteId: string) {
    return this.store.readStream(ctx, paqueteStreamId(paqueteId)).then((ev) => reconstruirPaquete(paqueteId, this.org(ctx), ev));
  }

  private async producirPieza(ctx: RequestContext, e: EntradaPipeline, brief: ContenidoBrief, a: Attribution, o: string) {
    const existente = await this.cargarPaquete(ctx, e.paqueteId);
    if (existente.existe) return existente;
    const payload = await this.factory.producir(ctx, {
      paqueteId: e.paqueteId, briefId: e.briefId, marcaId: brief.marcaId, planId: brief.planId, campaniaId: brief.campaniaId, actividadId: brief.actividadId,
      brief, marca: null, afirmacionesProhibidas: brief.afirmacionesProhibidas, canalesAutorizados: [e.canal], canalesDestino: [e.canal],
      promptPiezaRef: 'prompt:pieza:v1', promptAdaptRef: 'prompt:adapt:v1', occurredAt: o,
    });
    await this.store.append(ctx, paqueteStreamId(e.paqueteId), existente.version, [{ type: EVENTOS_PAQ.producido, payload, attribution: a, occurredAt: o }]);
    return this.cargarPaquete(ctx, e.paqueteId);
  }

  private async gobernarPieza(ctx: RequestContext, e: EntradaPipeline, refsM5: readonly { afirmacionId: string; version: number }[], a: Attribution, o: string) {
    const trazabilidad: TrazaAfirmacion[] = e.mensajes.filter((m) => m.afirmacionRespaldoId).map((m) => ({
      afirmacionId: m.afirmacionRespaldoId!, version: refsM5.find((r) => r.afirmacionId === m.afirmacionRespaldoId)?.version ?? 0,
      estado: 'VERDADERO', sentido: 'A_FAVOR', vigencia: 'VIGENTE', proposito: `mensaje ${m.tipo}`, mensajeId: m.mensajeId,
    }));
    const gobernanza: PayloadGobernanzaCreativa = {
      formato: e.formato, objetivo: e.brief.objetivoMarketing, segmento: e.brief.segmento, briefId: e.briefId, territorioId: e.territorioId, estrategiaCreativaId: e.estrategiaCreativaId,
      mensajesUtilizados: e.mensajes.map((m) => m.mensajeId), referenciasM5: refsM5, resultadoValidacion: 'VALIDO', versionConocimiento: versionConocimiento(refsM5), trazabilidad,
    };
    const st = await this.cargarPaquete(ctx, e.paqueteId);
    if (st.pieza?.trazabilidad && st.pieza.trazabilidad.length > 0) return; // idempotente: ya gobernada
    await this.store.append(ctx, paqueteStreamId(e.paqueteId), st.version, [{ type: EVENTOS_PAQ.gobernanza, payload: gobernanza, attribution: a, occurredAt: o }]);
  }

  private async registrarPiezaEnIndice(ctx: RequestContext, paqueteId: string, a: Attribution, o: string) {
    const org = this.org(ctx);
    const idx = reconstruirIndicePiezas(org, await this.store.readStream(ctx, indicePiezasStreamId(org)));
    if (idx.paquetes.includes(paqueteId)) return;
    const input: EventInput = { type: EVENTOS_INDICE_PIEZAS.registrada, payload: { paqueteId }, attribution: a, occurredAt: o };
    await this.store.append(ctx, indicePiezasStreamId(org), idx.version, [input]);
  }
}
