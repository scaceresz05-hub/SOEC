/**
 * @soec/motor-operacion · tests · SETUP compartido (no contiene tests).
 *
 * Monta la cadena real M5→M6→M7 sobre un `InMemoryEventStore` y expone helpers deterministas para las
 * matrices de reconciliación, fallos parciales, escenarios adversariales, gates de retry y replay frío.
 */
import { ActorId, OrganizationId, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { PipelineCreativoService, LecturaCreativaService, MotorCreativoService, esPropuesta, type EntradaPipeline, type ProductorPieza } from '@soec/motor-creativo';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente } from '@soec/contenido';
import {
  OperacionService, LecturaOperativaService, ReconciliadorService, AdaptadorEjecucionSimulado,
  trabajoId as trabajoIdDe, claveEfecto, reservaId,
  type EntradaOrden, type EscenarioSimulado, type PeticionEjecucion, type PuertoEjecucionSimulada, type ResultadoEjecucion, type ResultadoIntento,
} from '../src/index';

export { InMemoryEventStore, trabajoIdDe, claveEfecto, reservaId, AprobacionService, LecturaOperativaService, OperacionService, ReconciliadorService, AdaptadorEjecucionSimulado };
export type { EntradaOrden, EscenarioSimulado, PuertoEjecucionSimulada, PeticionEjecucion, RequestContext, RecordedEvent, EventStore, Attribution };

export const attr: Attribution = { source: 'm7', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
export const O = '2026-08-03T00:00:00.000Z';
export const FUTURO = '2026-09-01T10:00:00.000Z';
export const EXEC = '2026-09-01T11:00:00.000Z';
export const EXEC_LATE = '2026-09-01T13:00:00.000Z';

export function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

const MAPA: Record<EscenarioSimulado, { resultado: ResultadoIntento; codigoError: string | null; reintentable: boolean }> = {
  EXITO: { resultado: 'EJECUTADA_SIMULADA', codigoError: null, reintentable: false },
  FALLO_TEMPORAL: { resultado: 'FALLIDA_TEMPORAL', codigoError: 'TEMPORAL', reintentable: true },
  FALLO_PERMANENTE: { resultado: 'FALLIDA_PERMANENTE', codigoError: 'PERMANENTE', reintentable: false },
  RECHAZO: { resultado: 'RECHAZADA', codigoError: 'RECHAZO', reintentable: false },
};

/** Adaptador simulado cuyo escenario se puede cambiar entre intentos (para gates de retry). */
export class AdaptadorMutable implements PuertoEjecucionSimulada {
  constructor(public escenario: EscenarioSimulado = 'EXITO', public claseError?: string) {}
  async ejecutar(_p: PeticionEjecucion): Promise<ResultadoEjecucion> {
    const m = MAPA[this.escenario];
    return { resultado: m.resultado, codigoError: m.codigoError, reintentable: m.reintentable, naturaleza: 'SIMULADA', ...(this.claseError ? { claseError: this.claseError } : {}) };
  }
}

/** EventStore que falla el N-ésimo append de un tipo de evento dado (matriz de fallos parciales). */
export class StoreFallaEvento implements EventStore {
  constructor(private readonly inner: EventStore, private readonly triggers: Map<string, number>) {}
  async append(c: RequestContext, s: string, v: number, events: readonly EventInput[]) {
    for (const e of events) { const r = this.triggers.get(e.type) ?? 0; if (r > 0) { this.triggers.set(e.type, r - 1); throw new Error(`fallo simulado: ${e.type}`); } }
    return this.inner.append(c, s, v, events);
  }
  readStream(c: RequestContext, s: string): Promise<readonly RecordedEvent[]> { return this.inner.readStream(c, s); }
  reconstructAt(c: RequestContext, s: string, at: string): Promise<readonly RecordedEvent[]> { return this.inner.reconstructAt(c, s, at); }
  currentVersion(c: RequestContext, s: string): Promise<number> { return this.inner.currentVersion(c, s); }
}

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

const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productor: ProductorPieza = { async producir(_c, p): Promise<PayloadProducido> { return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' }; } };
const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };
const brief: ContenidoBrief = { organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01' };
const pipe: EntradaPipeline = { contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }], briefId: 'brief1', brief, territorioId: 'terr1', estrategiaCreativaId: 'estcr1', mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }], validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false }, paqueteId: 'paq1', formato: 'articulo', canal: 'blog', variante: { varianteId: 'v1', hipotesis: 'gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] }, calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' } };

async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion) {
  await m5.registrar(c, id, clase, `af ${id}`, attr, O);
  await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'd', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}

/** Conduce M5→M6 hasta una pieza aprobada+variante+calendarizada. Devuelve la versión aprobada de la pieza. */
export async function prepararM6(store: InMemoryEventStore, c: RequestContext): Promise<number> {
  const m5 = new MotorEstrategicoService(store); const motor = new MotorCreativoService(store, m5);
  await afirmar(m5, c, 'icp', 'ICP'); await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR'); await afirmar(m5, c, 'obj', 'OBJETIVO');
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'd', tension: 'x', beneficio: 'orden', prueba: 'c', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, attr, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
  await new EstrategiaCreativaArtefactoService(store).establecer(c, 'estcr1', contenidoArt, attr, O);
  const pipeline = new PipelineCreativoService(store, m5, { factory: productor }); const aprobacion = new AprobacionService(store);
  const r = await pipeline.componer(c, pipe, attr, O);
  if (!esPropuesta(r)) throw new Error('componer');
  await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: r.valor.piezaVersionParaAprobar, decision: 'APROBADA' }, attr, O);
  await aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
  await pipeline.calendarizar(c, pipe, attr, O);
  return r.valor.piezaVersionParaAprobar;
}

export function montarM7(store: EventStore, adaptador: PuertoEjecucionSimulada = new AdaptadorEjecucionSimulado(), opciones = {}) {
  const m5 = new MotorEstrategicoService(store); const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, adaptador, opciones);
  return { store, ordenes, lectura: new LecturaOperativaService(store, ordenes), reconciliador: new ReconciliadorService(store, ordenes) };
}

export const entradaOrden = (piezaVersion: number, over: Partial<EntradaOrden> = {}): EntradaOrden => ({
  capacidad: 'publicacion_social', pieza: { id: 'paq1', version: piezaVersion }, variante: { id: 'v1', version: 1 },
  programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog',
  instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob', ...over,
});

export async function hastaEnCola(ordenes: OperacionService, c: RequestContext, v: number, ordenId = 'orden1'): Promise<string> {
  await ordenes.crearOrden(c, ordenId, entradaOrden(v), attr, O);
  await ordenes.validar(c, ordenId, attr, O);
  await ordenes.programar(c, ordenId, O, attr, O);
  await ordenes.encolar(c, ordenId, attr, O);
  return trabajoIdDe('org-a', ordenId, 1);
}

export const CLAVE = (v: number, ordenId = 'orden1') => claveEfecto('org-a', ordenId, { id: 'paq1', version: v }, { id: 'v1', version: 1 }, 'publicacion_social');

/** Cuenta eventos de un tipo en un stream (para acreditar atomicidad lógica: efecto/consumo exactamente una vez). */
export async function contarEventos(store: EventStore, c: RequestContext, stream: string, tipo: string): Promise<number> {
  return (await store.readStream(c, stream)).filter((e) => e.type === tipo).length;
}
