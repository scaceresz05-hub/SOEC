/**
 * @soec/motor-medicion · tests · SETUP compartido (no contiene tests).
 *
 * Monta la cadena real M5→M6→M7→M8 sobre un `InMemoryEventStore`: produce una ejecución SIMULADA de M7,
 * registra una hipótesis canónica en M5, y cablea los servicios de M8 (observación, evaluación, aprendizaje,
 * lectura M9, reconciliador). Helpers deterministas para las matrices de M8.
 */
import { ActorId, OrganizationId, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { PipelineCreativoService, LecturaCreativaService, MotorCreativoService, esPropuesta, type EntradaPipeline, type ProductorPieza } from '@soec/motor-creativo';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente } from '@soec/contenido';
import { OperacionService, LecturaOperativaService, AdaptadorEjecucionSimulado, trabajoId as trabajoIdDe, type EntradaOrden } from '@soec/motor-operacion';
import {
  ObservacionService, EvaluacionService, AprendizajeOperacionalService, LecturaM9Service, ReconciliadorMedicionService,
  type EntradaObservacion, type EntradaEvaluacion,
} from '../src/index';

export { InMemoryEventStore, ObservacionService, EvaluacionService, AprendizajeOperacionalService, LecturaM9Service, ReconciliadorMedicionService, MotorEstrategicoService };
export type { RequestContext, EventStore, Attribution, EntradaObservacion, EntradaEvaluacion };

export const attr: Attribution = { source: 'm8', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
export const O = '2026-08-03T00:00:00.000Z';
export const FUTURO = '2026-09-01T10:00:00.000Z';
export const EXEC = '2026-09-01T11:00:00.000Z';

export function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productor: ProductorPieza = { async producir(_c, p): Promise<PayloadProducido> { return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' }; } };
const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };
const brief: ContenidoBrief = { organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01' };
const pipe: EntradaPipeline = { contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }], briefId: 'brief1', brief, territorioId: 'terr1', estrategiaCreativaId: 'estcr1', mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }], validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false }, paqueteId: 'paq1', formato: 'articulo', canal: 'blog', variante: { varianteId: 'v1', hipotesis: 'gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] }, calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' } };

async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion, aFavor = true) {
  await m5.registrar(c, id, clase, `af ${id}`, attr, O);
  await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'd', origen: 'DATO_IMPORTADO', sentido: aFavor ? 'A_FAVOR' : 'EN_CONTRA', pertinente: true }, attr, O);
}

export const entradaOrden = (piezaVersion: number, over: Partial<EntradaOrden> = {}): EntradaOrden => ({
  capacidad: 'publicacion_social', pieza: { id: 'paq1', version: piezaVersion }, variante: { id: 'v1', version: 1 },
  programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog',
  instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob', ...over,
});

/** EventStore que falla la N-ésima OCURRENCIA (1-based) de un tipo de evento — para la matriz por frontera. */
export class StoreFallaEnOcurrencia implements EventStore {
  private readonly conteo = new Map<string, number>();
  constructor(private readonly inner: EventStore, private readonly objetivo: { tipo: string; ocurrencia: number }) {}
  async append(c: RequestContext, s: string, v: number, events: readonly EventInput[]) {
    for (const e of events) {
      const n = (this.conteo.get(e.type) ?? 0) + 1;
      this.conteo.set(e.type, n);
      if (e.type === this.objetivo.tipo && n === this.objetivo.ocurrencia) throw new Error(`fallo simulado: ${e.type}#${n}`);
    }
    return this.inner.append(c, s, v, events);
  }
  readStream(c: RequestContext, s: string): Promise<readonly RecordedEvent[]> { return this.inner.readStream(c, s); }
  reconstructAt(c: RequestContext, s: string, at: string): Promise<readonly RecordedEvent[]> { return this.inner.reconstructAt(c, s, at); }
  currentVersion(c: RequestContext, s: string): Promise<number> { return this.inner.currentVersion(c, s); }
}

/** Monta M5→M6→M7 y M8. Registra la hipótesis 'hip1' (VERDADERO). Devuelve servicios + versión de pieza. */
export async function montarTodo(store: EventStore, c: RequestContext) {
  const m5 = new MotorEstrategicoService(store);
  const motor = new MotorCreativoService(store, m5);
  await afirmar(m5, c, 'icp', 'ICP'); await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR'); await afirmar(m5, c, 'obj', 'OBJETIVO');
  await afirmar(m5, c, 'hip1', 'HIPOTESIS'); // hipótesis experimental canónica (evaluable en M5)
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
  const ordenes = new OperacionService(store, creativa, new AdaptadorEjecucionSimulado());
  const lecturaM7 = new LecturaOperativaService(store, ordenes);

  const observaciones = new ObservacionService(store, lecturaM7);
  const evaluaciones = new EvaluacionService(store, observaciones, m5);
  const aprendizajesOp = new AprendizajeOperacionalService(store, evaluaciones);
  const lecturaM9 = new LecturaM9Service(store, observaciones, evaluaciones, aprendizajesOp);
  const reconciliador = new ReconciliadorMedicionService(observaciones, evaluaciones, aprendizajesOp, lecturaM7);
  return { store, m5, ordenes, lecturaM7, observaciones, evaluaciones, aprendizajesOp, lecturaM9, reconciliador, v };
}

/** Construye SOLO las fachadas de lectura/servicios M8 sobre un store existente (para replay frío). No escribe. */
export function montarLectura(store: EventStore) {
  const m5 = new MotorEstrategicoService(store);
  const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, new AdaptadorEjecucionSimulado());
  const lecturaM7 = new LecturaOperativaService(store, ordenes);
  const observaciones = new ObservacionService(store, lecturaM7);
  const evaluaciones = new EvaluacionService(store, observaciones, m5);
  const aprendizajesOp = new AprendizajeOperacionalService(store, evaluaciones);
  const lecturaM9 = new LecturaM9Service(store, observaciones, evaluaciones, aprendizajesOp);
  const reconciliador = new ReconciliadorMedicionService(observaciones, evaluaciones, aprendizajesOp, lecturaM7);
  return { m5, ordenes, lecturaM7, observaciones, evaluaciones, aprendizajesOp, lecturaM9, reconciliador };
}

/** Ejecuta una orden de M7 hasta EJECUTADA_SIMULADA. Devuelve el ordenId. */
export async function ejecutarOrden(ordenes: OperacionService, c: RequestContext, v: number, ordenId = 'orden1'): Promise<string> {
  await ordenes.crearOrden(c, ordenId, entradaOrden(v), attr, O);
  await ordenes.validar(c, ordenId, attr, O);
  await ordenes.programar(c, ordenId, O, attr, O);
  await ordenes.encolar(c, ordenId, attr, O);
  await ordenes.reclamarYEjecutar(c, trabajoIdDe('org-a', ordenId, 1), 'w1', EXEC, attr, O);
  return ordenId;
}

/** Crea una orden y la lleva a EJECUTADA_SIMULADA por inyección directa, SIN evidencia (ejecución parcial). */
export async function ejecutarSinEvidencia(ordenes: OperacionService, store: InMemoryEventStore, c: RequestContext, v: number, ordenId = 'ordenP'): Promise<string> {
  await ordenes.crearOrden(c, ordenId, entradaOrden(v), attr, O);
  const s = `orden:org-a:${ordenId}`;
  for (const e of ['VALIDADA', 'PROGRAMADA', 'EN_COLA', 'EN_EJECUCION', 'EJECUTADA_SIMULADA']) {
    await store.append(c, s, await store.currentVersion(c, s), [{ type: 'orden.transicionada', payload: { estado: e, motivo: 'inyección' }, attribution: attr, occurredAt: O }]);
  }
  return ordenId;
}

/** Ejecuta y luego COMPENSA una orden (queda COMPENSADA, no COMPLETA). */
export async function ejecutarYCompensar(ordenes: OperacionService, c: RequestContext, v: number, ordenId = 'ordenK'): Promise<string> {
  await ejecutarOrden(ordenes, c, v, ordenId);
  await ordenes.compensar(c, ordenId, 'reverso', attr, O);
  return ordenId;
}

/** Expectativa por defecto: KPI 'ctr', dirección subir, baseline 0.02, umbral 0.03, meta 0.05. */
export const expectativa = (kpiId = 'ctr', over: Partial<import('../src/index').ExpectativaResultado> = {}): import('../src/index').ExpectativaResultado => ({
  kpiId, direccion: 'subir', baseline: 0.02, umbral: 0.03, meta: 0.05, muestraMinima: 100, calidadMinima: 'media', coberturaMinima: 0.6, ...over,
});

/** Entrada de atribución directa por defecto. */
export const entradaAtribucion = (kpiId = 'ctr'): import('../src/index').EntradaAtribucion => ({
  kpiId, modelo: 'directa', ventana: '7d', eventosIncluidos: 10, eventosExcluidos: 0,
  hayIdentificadorDirecto: true, haySenalContribuyente: false, soloCoincidenciaTemporal: false, supuestos: [], naturaleza: 'SIMULADA',
});

/** Observación válida por defecto (valor 0.06 ⇒ supera la meta). */
export const obsEntrada = (ordenId: string, over: Partial<EntradaObservacion> = {}): EntradaObservacion => ({
  ordenId, hipotesisId: 'hip1', kpiId: 'ctr', instante: EXEC, fuente: 'ejecucion-simulada-m7', metrica: 'ctr',
  valor: 0.06, unidad: 'ratio', naturaleza: 'SIMULADA', calidad: 'alta', cobertura: 1, ...over,
});

/** Registra + valida una observación y devuelve su estado. */
export async function observar(observaciones: ObservacionService, c: RequestContext, id: string, ordenId: string, over: Partial<EntradaObservacion> = {}) {
  await observaciones.registrar(c, id, obsEntrada(ordenId, over), attr, O);
  return observaciones.validar(c, id, attr, O);
}

/** Entrada de evaluación por defecto (evidencia a favor domina, suficiente y pertinente). */
export const evalEntrada = (observacionId: string, over: Partial<EntradaEvaluacion> = {}): EntradaEvaluacion => ({
  observacionId, segmento: 'pymes', expectativa: expectativa(), hipotesisVersion: 1,
  evidenciaAFavor: 3, evidenciaEnContra: 0, observacionesExcluidas: 0, suficiente: true, pertinente: true,
  atribucion: entradaAtribucion(), ...over,
});
