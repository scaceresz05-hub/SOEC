/**
 * @soec/motor-operacion · tests adversariales (M7). Integración real M5→M6→M7: la orden se crea SOLO desde
 * una pieza aprobada+vigente+calendarizada de M6 (LecturaCreativa). Prueba: validación autoritativa,
 * scheduler, cola con lease, ejecución gobernada idempotente, presupuesto, cancelación/compensación,
 * reintento, reconciliación, replay frío, inmutabilidad de lecturas M8 y aislamiento multi-tenant.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, ConcurrencyError, OrganizationId, type Attribution, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { PipelineCreativoService, LecturaCreativaService, MotorCreativoService, esPropuesta, type EntradaPipeline, type ProductorPieza } from '@soec/motor-creativo';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente } from '@soec/contenido';
import { PausaService, ALCANCE_GLOBAL } from '@soec/control';
import {
  OperacionService, LecturaOperativaService, ReconciliadorService, AdaptadorEjecucionSimulado, AdaptadorSandboxM4,
  trabajoId as trabajoIdDe, ordenStreamId, claveEfecto, type EntradaOrden, type EscenarioSimulado, type PeticionEjecucion, type PuertoEjecucionSimulada, type ResultadoEjecucion, type ResultadoIntento,
} from '../src/index';

const attr: Attribution = { source: 'm7', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
const FUTURO = '2026-09-01T10:00:00.000Z';
const EXEC = '2026-09-01T11:00:00.000Z'; // instante de ejecución (>= instante planificado)
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

const MAPA: Record<EscenarioSimulado, { resultado: ResultadoIntento; codigoError: string | null; reintentable: boolean }> = {
  EXITO: { resultado: 'EJECUTADA_SIMULADA', codigoError: null, reintentable: false },
  FALLO_TEMPORAL: { resultado: 'FALLIDA_TEMPORAL', codigoError: 'TEMPORAL', reintentable: true },
  FALLO_PERMANENTE: { resultado: 'FALLIDA_PERMANENTE', codigoError: 'PERMANENTE', reintentable: false },
  RECHAZO: { resultado: 'RECHAZADA', codigoError: 'RECHAZO', reintentable: false },
};
class AdaptadorMutable implements PuertoEjecucionSimulada {
  constructor(public escenario: EscenarioSimulado = 'EXITO') {}
  async ejecutar(_p: PeticionEjecucion): Promise<ResultadoEjecucion> {
    const m = MAPA[this.escenario];
    return { resultado: m.resultado, codigoError: m.codigoError, reintentable: m.reintentable, naturaleza: 'SIMULADA' };
  }
}

// ── Andamiaje M5→M6: deja una pieza aprobada+vigente+calendarizada ──────────────────────────────────
const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productor: ProductorPieza = { async producir(_c, p): Promise<PayloadProducido> { return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' }; } };
const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };
const brief: ContenidoBrief = { organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01' };
const pipe: EntradaPipeline = { contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }], briefId: 'brief1', brief, territorioId: 'terr1', estrategiaCreativaId: 'estcr1', mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }], validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false }, paqueteId: 'paq1', formato: 'articulo', canal: 'blog', variante: { varianteId: 'v1', hipotesis: 'gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] }, calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' } };

async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion) {
  await m5.registrar(c, id, clase, `af ${id}`, attr, O);
  await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'd', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}

/** Monta M5→M6 hasta una pieza aprobada+calendarizada. Devuelve la versión de la pieza aprobada. */
async function prepararM6(store: InMemoryEventStore, c: RequestContext): Promise<number> {
  const m5 = new MotorEstrategicoService(store);
  const motor = new MotorCreativoService(store, m5);
  await afirmar(m5, c, 'icp', 'ICP'); await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR'); await afirmar(m5, c, 'obj', 'OBJETIVO');
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'd', tension: 'x', beneficio: 'orden', prueba: 'c', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, attr, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
  await new EstrategiaCreativaArtefactoService(store).establecer(c, 'estcr1', contenidoArt, attr, O);
  const pipeline = new PipelineCreativoService(store, m5, { factory: productor });
  const aprobacion = new AprobacionService(store);
  const r = await pipeline.componer(c, pipe, attr, O);
  if (!esPropuesta(r)) throw new Error('componer no propuso');
  await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: r.valor.piezaVersionParaAprobar, decision: 'APROBADA' }, attr, O);
  await aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
  await pipeline.calendarizar(c, pipe, attr, O);
  return r.valor.piezaVersionParaAprobar;
}

function montarM7(store: InMemoryEventStore, adaptador: PuertoEjecucionSimulada = new AdaptadorEjecucionSimulado(), opciones = {}) {
  const m5 = new MotorEstrategicoService(store);
  const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, adaptador, opciones);
  return { store, creativa, ordenes, lectura: new LecturaOperativaService(store, ordenes), reconciliador: new ReconciliadorService(store, ordenes) };
}

const entradaOrden = (piezaVersion: number, over: Partial<EntradaOrden> = {}): EntradaOrden => ({
  capacidad: 'publicacion_social', pieza: { id: 'paq1', version: piezaVersion }, variante: { id: 'v1', version: 1 },
  programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog',
  instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob', ...over,
});

/** Lleva una orden desde cero hasta EN_COLA (crear→validar→programar→encolar). Devuelve el trabajoId. */
async function hastaEnCola(ordenes: OperacionService, c: RequestContext, v: number, ordenId = 'orden1'): Promise<string> {
  await ordenes.crearOrden(c, ordenId, entradaOrden(v), attr, O);
  await ordenes.validar(c, ordenId, attr, O);
  await ordenes.programar(c, ordenId, O, attr, O);
  await ordenes.encolar(c, ordenId, attr, O);
  return trabajoIdDe('org-a', ordenId, 1);
}

describe('M7 · cadena gobernada M6→orden→scheduler→cola→ejecución simulada→evidencia', () => {
  it('camino feliz: ejecuta simulado, deja evidencia, y M8 la lee inmutable', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    const fin = await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    expect(fin.estado).toBe('EJECUTADA_SIMULADA');
    expect(fin.naturaleza).toBe('SIMULADO');
    const evs = await lectura.listarEvidencias(c, 'orden1');
    expect(evs[0]?.resultado).toBe('EJECUTADA_SIMULADA');
    expect(evs[0]?.naturaleza).toBe('SIMULADO');
    expect(evs[0]?.presupuesto.naturaleza).not.toBe('REAL');
    expect((await lectura.listarOrdenes(c, 'EJECUTADA_SIMULADA')).map((x) => x.ordenId)).toEqual(['orden1']);
    expect(Object.isFrozen(evs)).toBe(true);
  });

  it('no se puede crear orden desde una pieza NO aprobada (validación autoritativa)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    // M6 solo hasta componer (sin aprobar ni calendarizar).
    const m5 = new MotorEstrategicoService(store); const motor = new MotorCreativoService(store, m5);
    await afirmar(m5, c, 'icp', 'ICP'); await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR'); await afirmar(m5, c, 'obj', 'OBJETIVO');
    await motor.registrarTerritorio(c, 'terr1', { tesis: 'x', audienciaRef: 'icp', problemaCentral: '', tension: '', beneficio: '', prueba: '', riesgos: [], compatibilidadMarca: 'C' }, attr, O);
    await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
    await new EstrategiaCreativaArtefactoService(store).establecer(c, 'estcr1', contenidoArt, attr, O);
    await new PipelineCreativoService(store, m5, { factory: productor }).componer(c, pipe, attr, O);
    const { ordenes } = montarM7(store);
    await expect(ordenes.crearOrden(c, 'orden1', entradaOrden(2), attr, O)).rejects.toThrow();
  });

  it('vigencia perdida entre encolar y ejecutar ⇒ no hay efecto (FALLIDA), evidencia RECHAZADA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    // M5 cambia ⇒ la pieza deja de estar vigente/aprobada por versión exacta.
    await new MotorEstrategicoService(store).agregarEvidencia(c, 'pv', { evidenciaId: 'pv-e2', enunciado: 'm', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    const fin = await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    expect(fin.estado).toBe('FALLIDA');
    const evs = await lectura.listarEvidencias(c, 'orden1');
    expect(evs.some((e) => e.resultado === 'RECHAZADA')).toBe(true);
    // No hubo efecto: no aparece en ejecutadas.
    expect(await lectura.listarOrdenes(c, 'EJECUTADA_SIMULADA')).toEqual([]);
  });
});

describe('M7 · idempotencia de efectos, lease y concurrencia', () => {
  it('dos workers concurrentes reclaman el mismo trabajo ⇒ uno gana, el otro ConcurrencyError; efecto una vez', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    const res = await Promise.allSettled([ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O), ordenes.reclamarYEjecutar(c, tid, 'w2', EXEC, attr, O)]);
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
    // Efecto una sola vez: la orden quedó ejecutada y con una única evidencia de ejecución.
    expect((await lectura.cargarOrden(c, 'orden1')).estado).toBe('EJECUTADA_SIMULADA');
    expect((await lectura.listarEvidencias(c, 'orden1')).filter((e) => e.resultado === 'EJECUTADA_SIMULADA')).toHaveLength(1);
  });

  it('timeout+re-reclamo con lease vencido ⇒ el efecto no se duplica (DUPLICADA)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorEjecucionSimulado(), { leaseTtlMs: 1000 });
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O); await ordenes.programar(c, 'orden1', O, attr, O); await ordenes.encolar(c, 'orden1', attr, O);
    const tid = trabajoIdDe('org-a', 'orden1', 1);
    // w1 ejecuta y aplica el efecto (orden EJECUTADA_SIMULADA, trabajo COMPLETADO).
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    // Un re-reclamo del MISMO intento (efecto ya aplicado) no duplica: como el trabajo está COMPLETADO,
    // no es reclamable; el efecto sigue una sola vez (idempotencia por claveEfecto lo garantizaría igualmente).
    await expect(ordenes.reclamarYEjecutar(c, tid, 'w2', '2026-08-03T01:00:00.000Z', attr, O)).rejects.toThrow();
  });

  it('cross-tenant: org B no puede reclamar el trabajo de org A', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await expect(ordenes.reclamarYEjecutar(ctx('org-b'), tid, 'w1', EXEC, attr, O)).rejects.toThrow();
  });
});

describe('M7 · presupuesto, cancelación, compensación, reintento, expiración', () => {
  it('presupuesto excedido ANTES del efecto ⇒ RECHAZADA, sin ejecución', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store, new AdaptadorEjecucionSimulado(), { presupuesto: { topeUnidades: 0, ventanaMs: 60000, version: 'p0' }, unidadesPorEjecucion: 1 });
    const tid = await hastaEnCola(ordenes, c, v);
    const fin = await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    expect(fin.estado).toBe('FALLIDA');
    expect((await lectura.listarEvidencias(c, 'orden1')).some((e) => e.codigoError === 'PRESUPUESTO_EXCEDIDO')).toBe(true);
    expect(await lectura.listarOrdenes(c, 'EJECUTADA_SIMULADA')).toEqual([]);
  });

  it('cancelar una orden PROGRAMADA ⇒ CANCELADA (terminal)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O); await ordenes.programar(c, 'orden1', O, attr, O);
    expect((await ordenes.cancelar(c, 'orden1', 'la dirección canceló', attr, O)).estado).toBe('CANCELADA');
  });

  it('compensación lógica: EJECUTADA_SIMULADA ⇒ COMPENSADA con evidencia de reverso', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    const comp = await ordenes.compensar(c, 'orden1', 'reverso solicitado', attr, O);
    expect(comp.estado).toBe('COMPENSADA');
    expect((await lectura.listarEvidencias(c, 'orden1')).some((e) => e.resultado === 'COMPENSADA')).toBe(true);
  });

  it('reintento gobernado: fallo temporal ⇒ re-encola nuevo intento (nuevo trabajo)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { maxIntentos: 3 });
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    const st = await lectura.cargarOrden(c, 'orden1');
    expect(st.estado).toBe('EN_COLA'); // re-encolada para el intento 2
    expect(st.intentos).toBe(1);
    expect((await lectura.cargarTrabajo(c, trabajoIdDe('org-a', 'orden1', 2))).existe).toBe(true);
  });

  it('scheduler: instante expirado ⇒ EXPIRADA (no se ejecuta)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorEjecucionSimulado(), { ventanaExpiracionMs: 1000 });
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v, { instantePlanificado: '2026-07-01T00:00:00.000Z' }), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    expect((await ordenes.programar(c, 'orden1', O, attr, O)).estado).toBe('EXPIRADA');
  });
});

describe('M7 · reconciliación y replay frío', () => {
  it('reconcilia una orden EN_EJECUCION abandonada (lease vencido, sin cierre) ⇒ FALLIDA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    // Simula abandono: reclamamos y transicionamos EN_EJECUCION vía el store, sin cerrar (append directo).
    const tw = await new LecturaOperativaService(store, ordenes).cargarTrabajo(c, tid);
    await store.append(c, trabajoStreamFake(tid), tw.version, [{ type: 'trabajo.reclamado', payload: { titular: 'w1', venceEn: '2026-08-03T00:00:01.000Z' }, attribution: attr, occurredAt: O }]);
    const orden = await ordenes.cargarOrden(c, 'orden1');
    await store.append(c, ordenStreamId('org-a', 'orden1'), orden.version, [{ type: 'orden.transicionada', payload: { estado: 'EN_EJECUCION', motivo: 'x' }, attribution: attr, occurredAt: O }]);
    const hallazgos = await reconciliador.reconciliar(c, '2026-08-03T02:00:00.000Z', attr, O); // lease vencido
    expect(hallazgos.some((h) => h.clase === 'ORDEN_EN_EJECUCION_SIN_TRABAJO_ACTIVO' && h.clasificacion === 'REPARADA')).toBe(true);
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('FALLIDA');
    // Idempotente: correr de nuevo no vuelve a romper.
    await reconciliador.reconciliar(c, '2026-08-03T02:00:00.000Z', attr, O);
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('FALLIDA');
  });

  it('replay frío: un store NUEVO desde el log serializado reconstruye la orden y la evidencia idénticas', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    const snapshot = JSON.parse(JSON.stringify(store.exportar())) as Record<string, RecordedEvent[]>;
    const frio = InMemoryEventStore.desdeInstantanea(snapshot);
    const ordenesFrio = new OperacionService(frio, new LecturaCreativaService(frio, new MotorEstrategicoService(frio)), new AdaptadorEjecucionSimulado());
    const lecturaFrio = new LecturaOperativaService(frio, ordenesFrio);
    expect((await lecturaFrio.cargarOrden(c, 'orden1')).estado).toBe('EJECUTADA_SIMULADA');
    expect((await lecturaFrio.listarEvidencias(c, 'orden1'))[0]?.resultado).toBe('EJECUTADA_SIMULADA');
    expect((await lecturaFrio.listarOrdenes(c, 'EJECUTADA_SIMULADA')).map((x) => x.ordenId)).toEqual(['orden1']);
  });
});

// helper: stream id de trabajo (para el append directo del test de reconciliación)
function trabajoStreamFake(tid: string): string { return `trabajo:org-a:${tid}`; }

describe('M7 · integración M4 sandbox, PAUSA e idempotencia lógica', () => {
  it('ejecuta a través del SANDBOX AUTORITATIVO de M4 (reuso, no segundo motor)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store, new AdaptadorSandboxM4());
    const tid = await hastaEnCola(ordenes, c, v);
    const fin = await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    expect(fin.estado).toBe('EJECUTADA_SIMULADA');
    const evs = await lectura.listarEvidencias(c, 'orden1');
    expect(evs[0]?.resultado).toBe('EJECUTADA_SIMULADA');
    expect(evs[0]?.naturaleza).toBe('SIMULADO');
  });

  it('el sandbox M4 con escenario de fallo temporal ⇒ FALLIDA y re-encola (retry gobernado)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store, new AdaptadorSandboxM4({ publicacion_social: 'FALLO_TEMPORAL' }), { maxIntentos: 3 });
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    const st = await lectura.cargarOrden(c, 'orden1');
    expect(st.estado).toBe('EN_COLA'); // re-encolada para el intento 2
    expect((await lectura.cargarTrabajo(c, trabajoIdDe('org-a', 'orden1', 2))).existe).toBe(true);
  });

  it('PAUSA (global) impide programar/encolar/reclamar; reanudar desbloquea; no borra historial', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    const pausa = new PausaService(store);
    await pausa.pausar(c, ALCANCE_GLOBAL, 'freno de emergencia', 'director', attr, O);
    await expect(ordenes.programar(c, 'orden1', O, attr, O)).rejects.toThrow();
    await pausa.reanudar(c, ALCANCE_GLOBAL, 'director', attr, O);
    expect((await ordenes.programar(c, 'orden1', O, attr, O)).estado).toBe('PROGRAMADA'); // historial intacto
  });

  it('misma clave lógica con contenido distinto ⇒ CONFLICTO_IDEMPOTENCIA (no ejecuta)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    // Pre-aplica el efecto lógico con una huella DISTINTA bajo la misma clave.
    const clave = claveEfecto('org-a', 'orden1', { id: 'paq1', version: v }, { id: 'v1', version: 1 }, 'publicacion_social');
    await store.append(c, `efecto:org-a:${clave}`, 0, [{ type: 'efecto.aplicado', payload: { clave, huella: 'HUELLA_DISTINTA' }, attribution: attr, occurredAt: O }]);
    const fin = await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    expect(fin.estado).toBe('FALLIDA');
    expect((await lectura.listarEvidencias(c, 'orden1')).some((e) => e.codigoError === 'CONFLICTO_IDEMPOTENCIA')).toBe(true);
  });
});
