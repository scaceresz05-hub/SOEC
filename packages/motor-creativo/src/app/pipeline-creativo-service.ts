/**
 * @soec/motor-creativo · aplicación · PIPELINE CREATIVO (orquestación end-to-end, M6).
 *
 * Conecta la cadena completa, REUTILIZANDO los agregados existentes (no crea modelos paralelos):
 *   LecturaConocimiento(M5) → ContextoCreativo → Brief → Territorio → EstrategiaCreativa → Mensajes
 *   → Pieza (fábrica de @soec/contenido) → Variante A/B → Calendario (BORRADOR).
 *
 * Gobernanza dura: se ABSTIENE (resultado de primera clase) antes de producir cualquier artefacto
 * inválido; si la validación autoritativa falla, no crea pieza/variante/calendario; NUNCA aprueba
 * automáticamente; NUNCA programa (deja la entrada en BORRADOR); no publica, no gasta, no usa red.
 * Idempotente y multi-tenant (cada agregado subyacente lo es). Obsolescencia: verifica la vigencia del
 * contexto contra M5 antes de continuar; un contexto obsoleto detiene el pipeline con abstención.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import {
  EstrategiaCreativaArtefactoService,
  VariantesABService,
  CalendarioEditorialService,
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
import { type ResultadoCreativo, abstener, esPropuesta, proponer } from '../dominio/abstencion';
import type { MensajeCreativo } from '../dominio/mensaje';
import type { EntradaValidacionContenido } from '@soec/estrategia-creativa';
import { versionConocimiento } from '../dominio/vigencia';
import { contextoEvaluable } from '../dominio/contexto-creativo';

/** Entrada del pipeline: identidades + insumos. El contexto se construye desde M5 con `roles`. */
export interface EntradaPipeline {
  readonly contextoId: string;
  readonly roles: readonly { readonly rol: import('../dominio/contexto-creativo').RolConocimiento; readonly afirmacionId: string }[];
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

/** Puerto de producción de pieza: la fábrica canónica de `@soec/contenido` por defecto; inyectable. */
export interface ProductorPieza {
  producir(ctx: RequestContext, p: ProducirParams): Promise<PayloadProducido>;
}

export interface PlanCreativo {
  readonly contextoId: string;
  readonly briefId: string;
  readonly territorioId: string;
  readonly estrategiaCreativaId: string;
  readonly paqueteId: string;
  readonly varianteId: string | null;
  readonly entradaCalendarioId: string | null;
  readonly vigencia: 'VIGENTE';
  readonly resumen: string;
}

export class PipelineCreativoService {
  private readonly motor: MotorCreativoService;
  private readonly brief: BriefService;
  private readonly artefacto: EstrategiaCreativaArtefactoService;
  private readonly variantes: VariantesABService;
  private readonly calendario: CalendarioEditorialService;
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
    this.factory = deps?.factory ?? new FactoryService(new ProveedorGenerativoDeterminista());
  }

  /**
   * Ejecuta el pipeline completo, abstiéndose (con explicación) ante el primer gate que falle. Devuelve un
   * PlanCreativo estructurado y explicable, o una AbstencionCreativa. No produce efectos externos.
   */
  async componer(ctx: RequestContext, e: EntradaPipeline, a: Attribution, o: string): Promise<ResultadoCreativo<PlanCreativo>> {
    // 1) Contexto desde M5 + vigencia.
    const contexto = await this.motor.construirContexto(ctx, e.contextoId, e.roles, a, o);
    const desajustes = await this.motor.verificarVigencia(ctx, e.contextoId, a, o);
    if (desajustes.length > 0) {
      return abstener('CONOCIMIENTO_OBSOLETO', {
        porQue: 'el contexto creativo está obsoleto respecto de M5',
        evidenciaUsada: [],
        queFalta: ['reconstruir el contexto con las versiones vigentes de M5'],
        queImpediriaConcluir: [`${desajustes.length} referencia(s) de M5 cambiaron de versión`],
      });
    }
    // 2) Roles ESPECÍFICOS con abstención tipada (antes del gate genérico de faltantes).
    const icp = contexto.referencias.find((r) => r.rol === 'ICP');
    if (!icp || icp.estado !== 'VERDADERO') {
      return abstener('FALTA_AUDIENCIA', { porQue: 'sin ICP sostenido en M5', evidenciaUsada: [], queFalta: ['un ICP evaluado VERDADERO'], queImpediriaConcluir: ['audiencia no sostenida'] });
    }
    const pv = contexto.referencias.find((r) => r.rol === 'PROPUESTA_VALOR');
    if (!pv || pv.estado !== 'VERDADERO') {
      return abstener('FALTA_PROPUESTA_VALOR', { porQue: 'sin propuesta de valor sostenida en M5', evidenciaUsada: [], queFalta: ['una propuesta de valor evaluada VERDADERO'], queImpediriaConcluir: ['propuesta de valor no sostenida'] });
    }
    const obj = contexto.referencias.find((r) => r.rol === 'OBJETIVO');
    if (obj && obj.estado === 'NO_EVALUABLE') {
      return abstener('OBJETIVO_NO_EVALUABLE', { porQue: 'el objetivo referido no es evaluable en M5', evidenciaUsada: [], queFalta: ['sostener el objetivo con evidencia en M5'], queImpediriaConcluir: ['objetivo no evaluable'] });
    }

    // 3) Gate genérico: cualquier OTRO rol faltante/no-evaluable ⇒ conocimiento incompleto.
    if (!contextoEvaluable(contexto)) {
      return abstener('EVIDENCIA_INSUFICIENTE', {
        porQue: 'el contexto no es evaluable (conocimiento incompleto en M5)',
        evidenciaUsada: contexto.referencias.map((r) => r.afirmacionId),
        queFalta: [...contexto.faltantes],
        queImpediriaConcluir: ['faltan roles de conocimiento sostenidos en M5'],
      });
    }
    const refsM5 = contexto.referencias.map((r) => ({ afirmacionId: r.afirmacionId, version: r.version }));
    const versionesEsperadas: Record<string, number> = {};
    for (const r of contexto.referencias) versionesEsperadas[r.afirmacionId] = r.version;

    // 3) Brief evaluable con gobernanza M5 (inmutable por versión; refs, no copias).
    const briefGobernado: ContenidoBrief = {
      ...e.brief,
      contextoCreativoId: e.contextoId,
      referenciasM5: refsM5,
      informacionFaltante: contexto.faltantes,
      estadoEpistemico: 'VERDADERO',
      explicacion: 'brief derivado de un contexto creativo vigente y sostenido en M5',
      versionConocimiento: versionConocimiento(refsM5),
      vigencia: 'VIGENTE',
    };
    const briefSt = await this.brief.crear(ctx, e.briefId, briefGobernado, a, o);
    if (briefSt.estado === 'incompleto') {
      return abstener('EVIDENCIA_INSUFICIENTE', { porQue: 'el brief está incompleto', evidenciaUsada: [], queFalta: [...briefSt.faltantes], queImpediriaConcluir: ['brief incompleto'] });
    }

    // 4) Territorio evaluable (deriva de M5).
    const rt = await this.motor.evaluarTerritorio(ctx, e.territorioId);
    if (!esPropuesta(rt)) return rt as ResultadoCreativo<PlanCreativo>;

    // 5) Estrategia creativa existente → vincular gobernanza M5 (afirmaciones prohibidas, refs, vigencia).
    const art = await this.artefacto.cargar(ctx, e.estrategiaCreativaId);
    if (!art.existe) {
      return abstener('SIN_AFIRMACION_PERMITIDA', { porQue: 'no existe la estrategia creativa a gobernar', evidenciaUsada: [], queFalta: ['registrar la estrategia creativa (artefacto)'], queImpediriaConcluir: ['estrategia inexistente'] });
    }
    await this.artefacto.vincularGobernanzaM5(ctx, e.estrategiaCreativaId, {
      afirmacionesProhibidas: e.brief.afirmacionesProhibidas,
      referenciasM5: refsM5,
      estadoGobernanza: 'VIGENTE',
      contextoCreativoId: e.contextoId,
    }, a, o);

    // 6) Mensajes: validación AUTORITATIVA (texto A-3 + respaldo epistémico + versión + tipo). Sin autorización, no hay pieza.
    const veredicto = await this.motor.validarMensajesAutoritativo(ctx, e.validacion, e.mensajes, versionesEsperadas);
    if (!veredicto.autoriza) {
      return abstener('SIN_AFIRMACION_PERMITIDA', {
        porQue: 'la validación creativa autoritativa no autorizó el contenido',
        evidenciaUsada: e.mensajes.map((m) => m.afirmacionRespaldoId ?? '').filter(Boolean),
        queFalta: ['respaldar cada afirmación con conocimiento VERDADERO y vigente en M5'],
        queImpediriaConcluir: [...veredicto.razones],
      });
    }

    // 7) Pieza: producida por la fábrica canónica de @soec/contenido (reutilización), luego gobernada.
    const paq = await this.producirPieza(ctx, e, briefGobernado, a, o);
    if (paq.estado !== 'listo') {
      return abstener('EVIDENCIA_INSUFICIENTE', { porQue: `la pieza no quedó lista (${paq.estado})`, evidenciaUsada: [], queFalta: ['contenido válido para la pieza'], queImpediriaConcluir: [`estado de paquete: ${paq.estado}`] });
    }
    await this.gobernarPieza(ctx, e, refsM5, a, o);

    // 8) Variante A/B (reutiliza el dominio A/B; una sola variable).
    let varianteId: string | null = null;
    if (e.variante) {
      await this.variantes.agregarVariante(ctx, e.paqueteId, {
        varianteId: e.variante.varianteId,
        hipotesisQuePrueba: e.variante.hipotesis,
        elementoModificado: e.variante.elemento,
        diferenciaControlada: e.variante.diferencia,
        elementosConstantes: e.variante.constantes,
        criterioExito: 'mayor CTR (KPI futuro, sin métricas reales)',
      }, a, o);
      varianteId = e.variante.varianteId;
    }

    // 9) Calendario editorial: entrada en BORRADOR (NO se programa: eso exige aprobación humana canónica).
    let entradaCalendarioId: string | null = null;
    if (e.calendario) {
      await this.calendario.crear(ctx, e.calendario.programaId, e.calendario.zonaHoraria, a, o);
      await this.calendario.agregarEntrada(ctx, e.calendario.programaId, {
        entradaId: e.calendario.entradaId,
        fechaHora: e.calendario.fechaHora,
        canal: e.canal,
        piezaId: e.paqueteId,
        objetivo: e.calendario.objetivo,
        segmento: e.calendario.segmento,
      }, a, o);
      entradaCalendarioId = e.calendario.entradaId;
    }

    return proponer({
      contextoId: e.contextoId,
      briefId: e.briefId,
      territorioId: e.territorioId,
      estrategiaCreativaId: e.estrategiaCreativaId,
      paqueteId: e.paqueteId,
      varianteId,
      entradaCalendarioId,
      vigencia: 'VIGENTE',
      resumen: `pieza gobernada y trazable a ${refsM5.length} afirmaciones de M5; sin publicar ni programar`,
    });
  }

  /** Produce y persiste el paquete (pieza) por la fábrica canónica. Idempotente por paqueteId. */
  private async producirPieza(ctx: RequestContext, e: EntradaPipeline, brief: ContenidoBrief, a: Attribution, o: string) {
    const existente = reconstruirPaquete(e.paqueteId, String(ctx.organizationId), await this.store.readStream(ctx, paqueteStreamId(e.paqueteId)));
    if (existente.existe) return existente;
    const payload = await this.factory.producir(ctx, {
      paqueteId: e.paqueteId,
      briefId: e.briefId,
      marcaId: brief.marcaId,
      planId: brief.planId,
      campaniaId: brief.campaniaId,
      actividadId: brief.actividadId,
      brief,
      marca: null,
      afirmacionesProhibidas: brief.afirmacionesProhibidas,
      canalesAutorizados: [e.canal],
      canalesDestino: [e.canal],
      promptPiezaRef: 'prompt:pieza:v1',
      promptAdaptRef: 'prompt:adapt:v1',
      occurredAt: o,
    });
    await this.store.append(ctx, paqueteStreamId(e.paqueteId), existente.version, [
      { type: EVENTOS_PAQ.producido, payload, attribution: a, occurredAt: o },
    ]);
    return reconstruirPaquete(e.paqueteId, String(ctx.organizationId), await this.store.readStream(ctx, paqueteStreamId(e.paqueteId)));
  }

  /** Adjunta la gobernanza creativa M6 (formato, refs, trazabilidad autoritativa) a la pieza producida. */
  private async gobernarPieza(ctx: RequestContext, e: EntradaPipeline, refsM5: readonly { afirmacionId: string; version: number }[], a: Attribution, o: string) {
    const trazabilidad: TrazaAfirmacion[] = e.mensajes
      .filter((m) => m.afirmacionRespaldoId)
      .map((m) => ({
        afirmacionId: m.afirmacionRespaldoId!,
        version: versionesDe(refsM5, m.afirmacionRespaldoId!),
        estado: 'VERDADERO',
        sentido: 'A_FAVOR',
        vigencia: 'VIGENTE',
        proposito: `mensaje ${m.tipo}`,
        mensajeId: m.mensajeId,
      }));
    const gobernanza: PayloadGobernanzaCreativa = {
      formato: e.formato,
      objetivo: e.brief.objetivoMarketing,
      segmento: e.brief.segmento,
      briefId: e.briefId,
      territorioId: e.territorioId,
      estrategiaCreativaId: e.estrategiaCreativaId,
      mensajesUtilizados: e.mensajes.map((m) => m.mensajeId),
      referenciasM5: refsM5,
      resultadoValidacion: 'VALIDO',
      versionConocimiento: versionConocimiento(refsM5),
      trazabilidad,
    };
    const st = reconstruirPaquete(e.paqueteId, String(ctx.organizationId), await this.store.readStream(ctx, paqueteStreamId(e.paqueteId)));
    await this.store.append(ctx, paqueteStreamId(e.paqueteId), st.version, [
      { type: EVENTOS_PAQ.gobernanza, payload: gobernanza, attribution: a, occurredAt: o },
    ]);
  }
}

function versionesDe(refs: readonly { afirmacionId: string; version: number }[], id: string): number {
  return refs.find((r) => r.afirmacionId === id)?.version ?? 0;
}
