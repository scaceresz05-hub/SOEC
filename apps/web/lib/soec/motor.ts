/**
 * apps/web · lib/soec · CABLEADO DE LOS MOTORES M5–M9 (server-only).
 *
 * Construye la cadena real M5→M6→M7→M8→M9 sobre un `InMemoryEventStore` (modo SIMULADO) y la siembra con un
 * ciclo completo, para que la EXPERIENCIA consuma los PUERTOS DE LECTURA existentes (no datos inventados).
 * No crea motores nuevos: sólo instancia y siembra. Singleton por proceso.
 */
import 'server-only';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService } from '@soec/motor-estrategico';
import { PipelineCreativoService, LecturaCreativaService, MotorCreativoService, esPropuesta, type EntradaPipeline, type ProductorPieza } from '@soec/motor-creativo';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente } from '@soec/contenido';
import { OperacionService, LecturaOperativaService, AdaptadorEjecucionSimulado, trabajoId } from '@soec/motor-operacion';
import { ObservacionService, EvaluacionService, MemoriaService, ConsolidacionService, AprendizajeOperacionalService, LecturaM9Service } from '@soec/motor-medicion';
import {
  OptimizacionService, PropuestaService, MemoriaDecisionesService, ReconciliadorOptimizacionService, LecturaCicloSoecService,
  type AplicadorCambios, type Alternativa, type Oportunidad, type PoliticaOptimizacion, type PoliticaOscilacion,
} from '@soec/motor-optimizacion';

const ORG = 'org-demo';
const A: Attribution = { source: 'web', purpose: 'demo', assumptions: ['simulado'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
const FUTURO = '2026-09-01T10:00:00.000Z';
const EXEC = '2026-09-01T11:00:00.000Z';
export const AHORA = '2026-09-10T00:00:00.000Z';
export const POL_OPT: PoliticaOptimizacion = { version: 'p', requiereExperimentoControlado: false, exigirLimitePresupuesto: true, topePresupuesto: 100, confianzaMinima: 'media', permitirIrreversibleAltoRiesgo: false };
export const POL_OSC: PoliticaOscilacion = { cooldownMs: 0, maxCambiosPorVentana: 5, ventanaMs: 86400000, maxReoptimizaciones: 10, minEvidencia: 1 };

export function ctx(): RequestContext {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'web' };
}

const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productor: ProductorPieza = { async producir(_c, p): Promise<PayloadProducido> { return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' }; } };
const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };
const brief: ContenidoBrief = { organizationId: ORG, marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01' };
const pipe: EntradaPipeline = { contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }], briefId: 'brief1', brief, territorioId: 'terr1', estrategiaCreativaId: 'estcr1', mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }], validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false }, paqueteId: 'paq1', formato: 'articulo', canal: 'blog', variante: { varianteId: 'v1', hipotesis: 'gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] }, calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' } };

export const alternativa: Alternativa = { alternativaId: 'alt-repetir', oportunidadId: 'op1', cambia: ['politica_operacional'], constantes: ['segmento', 'hipotesis'], razon: 'repetir lo que funcionó', hipotesisId: 'hip1', riesgo: 'bajo', costoEstimado: 10, beneficioEsperado: 'más personas interesadas', kpiAfectado: 'ctr', evidencia: ['eval1 respaldada'], condicionesExito: ['más clics'], condicionesAbandono: ['menos clics'], planReversion: 'volver al plan anterior', alcance: 'LOCAL', naturaleza: 'SIMULADO' };
const oportunidad: Oportunidad = { oportunidadId: 'op1', tipo: 'repetir', fundamento: 'evidencia respaldada', evidencia: ['eval1'], contraevidencia: [], alcance: 'LOCAL', confianza: 'media', riesgo: 'bajo', costoEstimado: 10, impactoEsperado: 'que más personas hagan clic', reversibilidad: 'reversible', restricciones: [], informacionFaltante: [], dependencias: [], naturaleza: 'SIMULADO' };

export interface Soec {
  ctx: RequestContext;
  optimizacion: OptimizacionService; propuestas: PropuestaService; memoriaDec: MemoriaDecisionesService;
  reconciliador: ReconciliadorOptimizacionService; lecturaSoec: LecturaCicloSoecService;
  lecturaM8: LecturaM9Service; lecturaM7: LecturaOperativaService; m5: MotorEstrategicoService;
}

let cache: Promise<Soec> | null = null;

async function construir(): Promise<Soec> {
  const store = new InMemoryEventStore();
  const c = ctx();
  const m5 = new MotorEstrategicoService(store);
  const motor = new MotorCreativoService(store, m5);
  const afirmar = async (id: string, clase: 'ICP' | 'PROPUESTA_VALOR' | 'OBJETIVO' | 'HIPOTESIS') => {
    await m5.registrar(c, id, clase, `af ${id}`, A, O);
    await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'd', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, A, O);
  };
  await afirmar('icp', 'ICP'); await afirmar('pv', 'PROPUESTA_VALOR'); await afirmar('obj', 'OBJETIVO'); await afirmar('hip1', 'HIPOTESIS');
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'd', tension: 'x', beneficio: 'orden', prueba: 'c', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, A, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, A, O);
  await new EstrategiaCreativaArtefactoService(store).establecer(c, 'estcr1', contenidoArt, A, O);
  const pipeline = new PipelineCreativoService(store, m5, { factory: productor });
  const aprobacion = new AprobacionService(store);
  const r = await pipeline.componer(c, pipe, A, O);
  if (!esPropuesta(r)) throw new Error('componer');
  const v = r.valor.piezaVersionParaAprobar;
  await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: v, decision: 'APROBADA' }, A, O);
  await aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'APROBADA' }, A, O);
  await pipeline.calendarizar(c, pipe, A, O);

  const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, new AdaptadorEjecucionSimulado());
  const lecturaM7 = new LecturaOperativaService(store, ordenes);
  // M7: ejecución simulada de la campaña.
  await ordenes.crearOrden(c, 'orden1', { capacidad: 'publicacion_social', pieza: { id: 'paq1', version: v }, variante: { id: 'v1', version: 1 }, programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog', instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob' }, A, O);
  await ordenes.validar(c, 'orden1', A, O); await ordenes.programar(c, 'orden1', O, A, O); await ordenes.encolar(c, 'orden1', A, O);
  await ordenes.reclamarYEjecutar(c, trabajoId(ORG, 'orden1', 1), 'w1', EXEC, A, O);
  // M8: observación + evaluación (CTR 6% > meta 5% ⇒ hipótesis respaldada).
  const observaciones = new ObservacionService(store, lecturaM7);
  const memoriaMed = new MemoriaService(store);
  const evaluaciones = new EvaluacionService(store, observaciones, m5, memoriaMed);
  const consolidaciones = new ConsolidacionService(store, evaluaciones);
  const aprendizajesOp = new AprendizajeOperacionalService(store, evaluaciones);
  const lecturaM8 = new LecturaM9Service(store, observaciones, evaluaciones, aprendizajesOp, memoriaMed, consolidaciones);
  await observaciones.registrar(c, 'obs1', { ordenId: 'orden1', hipotesisId: 'hip1', kpiId: 'ctr', instante: EXEC, fuente: 'ejecucion-simulada-m7', metrica: 'ctr', valor: 0.06, unidad: 'ratio', naturaleza: 'SIMULADA', calidad: 'alta', cobertura: 1 }, A, O);
  await observaciones.validar(c, 'obs1', A, O);
  await evaluaciones.evaluar(c, 'eval1', { observacionId: 'obs1', segmento: 'pymes', expectativa: { kpiId: 'ctr', direccion: 'subir', baseline: 0.02, umbral: 0.03, meta: 0.05, muestraMinima: 100, calidadMinima: 'media', coberturaMinima: 0.6 }, hipotesisVersion: 1, evidenciaAFavor: 3, evidenciaEnContra: 0, observacionesExcluidas: 0, suficiente: true, pertinente: true, atribucion: { kpiId: 'ctr', modelo: 'directa', ventana: '7d', eventosIncluidos: 10, eventosExcluidos: 0, hayIdentificadorDirecto: true, haySenalContribuyente: false, soloCoincidenciaTemporal: false, supuestos: [], naturaleza: 'SIMULADA' } }, A, O);
  await aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', A, O);

  // M9: ciclo de optimización con UNA propuesta PENDIENTE de aprobación.
  const aplicador: AplicadorCambios = { async aplicar(cx, cambio, at, oo) { const nuevoPlan = `${cambio.versionesBase.planRef}-v2`; await ordenes.crearOrden(cx, nuevoPlan, { capacidad: 'publicacion_social', pieza: { id: 'paq1', version: cambio.versionesBase.piezaVersion }, variante: { id: 'v1', version: 1 }, programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog', instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob' }, at, oo); return { macrobloque: 'M7', artefacto: 'orden', versionAnterior: cambio.versionesBase.planRef, versionNueva: nuevoPlan }; } };
  const optimizacion = new OptimizacionService(store, m5, creativa, lecturaM7, lecturaM8);
  const memoriaDec = new MemoriaDecisionesService(store);
  const propuestas = new PropuestaService(store, optimizacion, aprobacion, aplicador, memoriaDec);
  const reconciliador = new ReconciliadorOptimizacionService(store, optimizacion, propuestas, memoriaDec, POL_OSC);
  const lecturaSoec = new LecturaCicloSoecService(store, optimizacion, propuestas, memoriaDec);
  const vb = { hipotesisId: 'hip1', hipotesisVersion: 1, piezaId: 'paq1', piezaVersion: v, varianteId: 'v1', varianteVersion: 1, planRef: 'orden1' };
  await optimizacion.abrir(c, 'ciclo1', { objetivo: 'Dar a conocer la marca entre pymes', segmento: 'pymes', versionesBase: vb, presupuestoDisponible: 100 }, A, O);
  await optimizacion.recopilarEvidencia(c, 'ciclo1', A, O);
  await optimizacion.evaluar(c, 'ciclo1', A, O);
  await optimizacion.registrarOportunidad(c, 'ciclo1', oportunidad, A, O);
  await optimizacion.registrarAlternativa(c, 'ciclo1', alternativa, A, O);
  await optimizacion.comparar(c, 'ciclo1', POL_OPT, A, O);
  await propuestas.proponer(c, 'prop1', { cicloId: 'ciclo1', versionesBase: vb, alternativaElegida: alternativa, alternativasDescartadas: [], artefactosAfectados: ['plan'], hipotesisId: 'hip1', kpis: ['ctr'], evidencia: ['eval1'], contraevidencia: [], impactoEsperado: 'que más personas hagan clic', costoEstimado: 10, riesgos: [], rollbackLogico: 'volver al plan anterior', explicacion: 'El mensaje más directo tuvo mejor respuesta que la meta; propongo repetirlo para confirmarlo antes de darlo por seguro.', naturaleza: 'SIMULADO' }, A, O);

  return { ctx: c, optimizacion, propuestas, memoriaDec, reconciliador, lecturaSoec, lecturaM8, lecturaM7, m5 };
}

/** Devuelve la cadena de motores sembrada (singleton por proceso). */
export function getSoec(): Promise<Soec> {
  if (!cache) cache = construir();
  return cache;
}

/** Reconstruye la cadena (tras aplicar una decisión que muta el estado). */
export function resetSoec(): void { cache = null; }

export const IDS = { ciclo: 'ciclo1', propuesta: 'prop1' };
