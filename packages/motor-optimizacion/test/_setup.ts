/**
 * @soec/motor-optimizacion · tests · SETUP compartido (no contiene tests).
 *
 * Monta la cadena real M5→M6→M7→M8→M9 sobre un `InMemoryEventStore`, produce evidencia M8 vigente, y cablea
 * los servicios de M9 con un `AplicadorCambios` CANÓNICO (crea nuevas versiones vía los servicios reales).
 */
import { ActorId, OrganizationId, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { PipelineCreativoService, LecturaCreativaService, MotorCreativoService, esPropuesta, type EntradaPipeline, type ProductorPieza } from '@soec/motor-creativo';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente } from '@soec/contenido';
import { OperacionService, LecturaOperativaService, AdaptadorEjecucionSimulado, trabajoId as trabajoIdDe, type EntradaOrden } from '@soec/motor-operacion';
import { ObservacionService, EvaluacionService, MemoriaService, ConsolidacionService, AprendizajeOperacionalService, LecturaM9Service, type EntradaObservacion, type EntradaEvaluacion } from '@soec/motor-medicion';
import {
  OptimizacionService, PropuestaService, MemoriaDecisionesService, ReconciliadorOptimizacionService, LecturaCicloSoecService,
  type AplicadorCambios, type CambioAAplicar, type VersionesBase, type Alternativa, type Oportunidad, type PoliticaOptimizacion, type PoliticaOscilacion,
} from '../src/index';

export { InMemoryEventStore, OptimizacionService, PropuestaService, MemoriaDecisionesService, ReconciliadorOptimizacionService, LecturaCicloSoecService };
export type { RequestContext, EventStore, Attribution, VersionesBase, Alternativa, Oportunidad };

export const attr: Attribution = { source: 'm9', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
export const O = '2026-08-03T00:00:00.000Z';
export const FUTURO = '2026-09-01T10:00:00.000Z';
export const EXEC = '2026-09-01T11:00:00.000Z';
export const AHORA = '2026-09-10T00:00:00.000Z';

export function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

export const POL_OPT: PoliticaOptimizacion = { version: 'p', requiereExperimentoControlado: false, exigirLimitePresupuesto: true, topePresupuesto: 100, confianzaMinima: 'media', permitirIrreversibleAltoRiesgo: false };
export const POL_OSC: PoliticaOscilacion = { cooldownMs: 0, maxCambiosPorVentana: 5, ventanaMs: 86400000, maxReoptimizaciones: 10, minEvidencia: 1 };

const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productor: ProductorPieza = { async producir(_c, p): Promise<PayloadProducido> { return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' }; } };
const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };
const brief: ContenidoBrief = { organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01' };
const pipe: EntradaPipeline = { contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }], briefId: 'brief1', brief, territorioId: 'terr1', estrategiaCreativaId: 'estcr1', mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }], validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false }, paqueteId: 'paq1', formato: 'articulo', canal: 'blog', variante: { varianteId: 'v1', hipotesis: 'gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] }, calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' } };

async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion) {
  await m5.registrar(c, id, clase, `af ${id}`, attr, O);
  await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'd', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}
const entradaOrden = (piezaVersion: number, over: Partial<EntradaOrden> = {}): EntradaOrden => ({
  capacidad: 'publicacion_social', pieza: { id: 'paq1', version: piezaVersion }, variante: { id: 'v1', version: 1 },
  programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog',
  instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob', ...over,
});
const obsEntrada = (ordenId: string, over: Partial<EntradaObservacion> = {}): EntradaObservacion => ({
  ordenId, hipotesisId: 'hip1', kpiId: 'ctr', instante: EXEC, fuente: 'ejecucion-simulada-m7', metrica: 'ctr', valor: 0.06, unidad: 'ratio', naturaleza: 'SIMULADA', calidad: 'alta', cobertura: 1, ...over,
});
const evalEntrada = (observacionId: string): EntradaEvaluacion => ({
  observacionId, segmento: 'pymes', expectativa: { kpiId: 'ctr', direccion: 'subir', baseline: 0.02, umbral: 0.03, meta: 0.05, muestraMinima: 100, calidadMinima: 'media', coberturaMinima: 0.6 },
  hipotesisVersion: 1, evidenciaAFavor: 3, evidenciaEnContra: 0, observacionesExcluidas: 0, suficiente: true, pertinente: true,
  atribucion: { kpiId: 'ctr', modelo: 'directa', ventana: '7d', eventosIncluidos: 10, eventosExcluidos: 0, hayIdentificadorDirecto: true, haySenalContribuyente: false, soloCoincidenciaTemporal: false, supuestos: [], naturaleza: 'SIMULADA' },
});

/** Monta M5→M6→M7→M8 y M9. Devuelve servicios + versión de pieza + AplicadorCambios canónico. */
export async function montarTodo(store: EventStore, c: RequestContext, opcionesM7: Record<string, unknown> = {}) {
  const m5 = new MotorEstrategicoService(store);
  const motor = new MotorCreativoService(store, m5);
  await afirmar(m5, c, 'icp', 'ICP'); await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR'); await afirmar(m5, c, 'obj', 'OBJETIVO'); await afirmar(m5, c, 'hip1', 'HIPOTESIS');
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'd', tension: 'x', beneficio: 'orden', prueba: 'c', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, attr, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
  await new EstrategiaCreativaArtefactoService(store).establecer(c, 'estcr1', contenidoArt, attr, O);
  const pipeline = new PipelineCreativoService(store, m5, { factory: productor }); const aprobacion = new AprobacionService(store);
  const r = await pipeline.componer(c, pipe, attr, O);
  if (!esPropuesta(r)) throw new Error('componer');
  const v = r.valor.piezaVersionParaAprobar;
  await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: v, decision: 'APROBADA' }, attr, O);
  await aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
  await pipeline.calendarizar(c, pipe, attr, O);

  const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, new AdaptadorEjecucionSimulado(), opcionesM7);
  const lecturaM7 = new LecturaOperativaService(store, ordenes);
  const observaciones = new ObservacionService(store, lecturaM7);
  const memoriaMed = new MemoriaService(store);
  const evaluaciones = new EvaluacionService(store, observaciones, m5, memoriaMed);
  const consolidaciones = new ConsolidacionService(store, evaluaciones);
  const aprendizajesOp = new AprendizajeOperacionalService(store, evaluaciones);
  const lecturaM8 = new LecturaM9Service(store, observaciones, evaluaciones, aprendizajesOp, memoriaMed, consolidaciones);

  // AplicadorCambios CANÓNICO: crea nuevas versiones reales. 'hipotesis'→M5, 'variante'/'pieza'→M6, else→M7.
  const aplicador: AplicadorCambios = {
    async aplicar(cx, cambio: CambioAAplicar, at, oo) {
      const vb = cambio.versionesBase;
      if (cambio.variable === 'hipotesis') {
        await m5.agregarEvidencia(cx, vb.hipotesisId, { evidenciaId: `hip-nueva-${cambio.valorNuevo}`, enunciado: 'refuerzo', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, at, oo);
        return { macrobloque: 'M5', artefacto: vb.hipotesisId, versionAnterior: String(vb.hipotesisVersion), versionNueva: `${vb.hipotesisVersion + 1}` };
      }
      if (cambio.variable === 'variante' || cambio.variable === 'pieza') {
        await aprobacion.decidir(cx, { resourceType: 'VARIANTE', resourceId: vb.varianteId, resourceVersion: vb.varianteVersion + 1, decision: 'APROBADA' }, at, oo);
        return { macrobloque: 'M6', artefacto: vb.varianteId, versionAnterior: String(vb.varianteVersion), versionNueva: `${vb.varianteVersion + 1}` };
      }
      // Nuevo PLAN operacional = nueva orden M7 (nueva versión del plan) para la próxima iteración.
      const nuevoPlan = `${vb.planRef}-v2`;
      await ordenes.crearOrden(cx, nuevoPlan, entradaOrden(vb.piezaVersion), at, oo);
      return { macrobloque: 'M7', artefacto: 'orden', versionAnterior: vb.planRef, versionNueva: nuevoPlan };
    },
  };

  const optimizacion = new OptimizacionService(store, m5, creativa, lecturaM7, lecturaM8);
  const memoriaDec = new MemoriaDecisionesService(store);
  const propuestas = new PropuestaService(store, optimizacion, aprobacion, aplicador, memoriaDec);
  const reconciliador = new ReconciliadorOptimizacionService(store, optimizacion, propuestas, memoriaDec, POL_OSC);
  const lecturaSoec = new LecturaCicloSoecService(store, optimizacion, propuestas, memoriaDec);
  return { store, m5, creativa, ordenes, lecturaM7, observaciones, evaluaciones, lecturaM8, aplicador, aprobacion, optimizacion, memoriaDec, propuestas, reconciliador, lecturaSoec, v };
}

/** Construye SOLO los servicios (read + M9) sobre un store existente, sin re-ejecutar la cadena (replay). */
export function montarLectura(store: EventStore) {
  const m5 = new MotorEstrategicoService(store);
  const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, new AdaptadorEjecucionSimulado());
  const lecturaM7 = new LecturaOperativaService(store, ordenes);
  const observaciones = new ObservacionService(store, lecturaM7);
  const memoriaMed = new MemoriaService(store);
  const evaluaciones = new EvaluacionService(store, observaciones, m5, memoriaMed);
  const consolidaciones = new ConsolidacionService(store, evaluaciones);
  const aprendizajesOp = new AprendizajeOperacionalService(store, evaluaciones);
  const lecturaM8 = new LecturaM9Service(store, observaciones, evaluaciones, aprendizajesOp, memoriaMed, consolidaciones);
  const optimizacion = new OptimizacionService(store, m5, creativa, lecturaM7, lecturaM8);
  const memoriaDec = new MemoriaDecisionesService(store);
  const aprobacion = new AprobacionService(store);
  const propuestas = new PropuestaService(store, optimizacion, aprobacion, { async aplicar() { throw new Error('lectura'); } }, memoriaDec);
  const lecturaSoec = new LecturaCicloSoecService(store, optimizacion, propuestas, memoriaDec);
  return { optimizacion, propuestas, memoriaDec, lecturaSoec };
}

/** Ejecuta una orden M7 y produce observación+evaluación M8 (evidencia vigente). Devuelve el ordenId. */
export async function ejecutarYMedir(t: Awaited<ReturnType<typeof montarTodo>>, c: RequestContext, ordenId: string, obsId: string, evalId: string): Promise<string> {
  await t.ordenes.crearOrden(c, ordenId, entradaOrden(t.v), attr, O);
  await t.ordenes.validar(c, ordenId, attr, O);
  await t.ordenes.programar(c, ordenId, O, attr, O);
  await t.ordenes.encolar(c, ordenId, attr, O);
  await t.ordenes.reclamarYEjecutar(c, trabajoIdDe('org-a', ordenId, 1), 'w1', EXEC, attr, O);
  await t.observaciones.registrar(c, obsId, obsEntrada(ordenId), attr, O);
  await t.observaciones.validar(c, obsId, attr, O);
  await t.evaluaciones.evaluar(c, evalId, evalEntrada(obsId), attr, O);
  return ordenId;
}

export const versionesBase = (t: { v: number }, planRef: string): VersionesBase => ({
  hipotesisId: 'hip1', hipotesisVersion: 1, piezaId: 'paq1', piezaVersion: t.v, varianteId: 'v1', varianteVersion: 1, planRef,
});

/** Alternativa por defecto (cambia el plan operacional, con evidencia y plan de reversión). */
export const altPlan = (id = 'alt1', over: Partial<Alternativa> = {}): Alternativa => ({
  alternativaId: id, oportunidadId: 'op1', cambia: ['politica_operacional'], constantes: ['segmento', 'hipotesis'], razon: 'mejorar el plan',
  hipotesisId: 'hip1', riesgo: 'bajo', costoEstimado: 10, beneficioEsperado: 'mejor CTR', kpiAfectado: 'ctr', evidencia: ['eval respaldada'],
  condicionesExito: ['CTR sube'], condicionesAbandono: ['CTR baja'], planReversion: 'volver al plan anterior', alcance: 'LOCAL', naturaleza: 'SIMULADO', ...over,
});
export const oportunidad = (id = 'op1', over: Partial<Oportunidad> = {}): Oportunidad => ({
  oportunidadId: id, tipo: 'repetir', fundamento: 'evidencia respaldada', evidencia: ['eval1'], contraevidencia: [], alcance: 'LOCAL',
  confianza: 'media', riesgo: 'bajo', costoEstimado: 10, impactoEsperado: 'mejor CTR', reversibilidad: 'reversible', restricciones: [], informacionFaltante: [], dependencias: [], naturaleza: 'SIMULADO', ...over,
});
export const decisionHumana = { actorHumano: 'humano-1', decisionId: 'dec-1', justificacion: 'evidencia suficiente' };

export const cuerpoPropuesta = (t: { v: number }, cicloId: string, planRef: string, alt: Alternativa, over: Record<string, unknown> = {}) => ({
  cicloId, versionesBase: versionesBase(t, planRef), alternativaElegida: alt, alternativasDescartadas: [], artefactosAfectados: ['plan'],
  hipotesisId: 'hip1', kpis: ['ctr'], evidencia: ['eval1'], contraevidencia: [], impactoEsperado: 'mejor CTR', costoEstimado: 10, riesgos: [],
  rollbackLogico: 'volver', explicacion: 'respaldada', naturaleza: 'SIMULADO' as const, ...over,
});

/** abrir→recopilar→evaluar→oportunidad→alternativa→comparar→proponer (queda PENDIENTE_APROBACION). */
export async function flujoHastaPropuesta(t: Awaited<ReturnType<typeof montarTodo>>, c: RequestContext, cicloId: string, propId: string, planRef: string, alt: Alternativa) {
  await t.optimizacion.abrir(c, cicloId, { objetivo: 'mejorar CTR', segmento: 'pymes', versionesBase: versionesBase(t, planRef), presupuestoDisponible: 100 }, attr, O);
  await t.optimizacion.recopilarEvidencia(c, cicloId, attr, O);
  await t.optimizacion.evaluar(c, cicloId, attr, O);
  await t.optimizacion.registrarOportunidad(c, cicloId, oportunidad(), attr, O);
  await t.optimizacion.registrarAlternativa(c, cicloId, alt, attr, O);
  await t.optimizacion.comparar(c, cicloId, POL_OPT, attr, O);
  await t.propuestas.proponer(c, propId, cuerpoPropuesta(t, cicloId, planRef, alt), attr, O);
}

/** Flujo completo hasta APLICADA_SIMULADA (aprobación humana + aplicación simulada). */
export async function flujoAplicado(t: Awaited<ReturnType<typeof montarTodo>>, c: RequestContext, cicloId: string, propId: string, planRef: string, alt: Alternativa) {
  await flujoHastaPropuesta(t, c, cicloId, propId, planRef, alt);
  await t.propuestas.aprobar(c, propId, decisionHumana, attr, O);
  return t.propuestas.aplicarSimulado(c, propId, POL_OSC, AHORA, attr, O);
}

/** Store que falla la N-ésima ocurrencia de un tipo de evento (matriz por frontera). */
export class StoreFallaEnOcurrencia implements EventStore {
  private readonly conteo = new Map<string, number>();
  constructor(private readonly inner: EventStore, private readonly objetivo: { tipo: string; ocurrencia: number }) {}
  async append(c: RequestContext, s: string, v: number, events: readonly EventInput[]) {
    for (const e of events) { const n = (this.conteo.get(e.type) ?? 0) + 1; this.conteo.set(e.type, n); if (e.type === this.objetivo.tipo && n === this.objetivo.ocurrencia) throw new Error(`fallo simulado: ${e.type}#${n}`); }
    return this.inner.append(c, s, v, events);
  }
  readStream(c: RequestContext, s: string): Promise<readonly RecordedEvent[]> { return this.inner.readStream(c, s); }
  reconstructAt(c: RequestContext, s: string, at: string): Promise<readonly RecordedEvent[]> { return this.inner.reconstructAt(c, s, at); }
  currentVersion(c: RequestContext, s: string): Promise<number> { return this.inner.currentVersion(c, s); }
}
