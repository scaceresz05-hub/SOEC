/**
 * @soec/motor-operacion · tests · CIERRE M7 — ciclo presupuestario (reserva→confirma/libera), compensación
 * de primera clase, reconciliador exhaustivo, fallos parciales por frontera, replay frío integral e
 * inmutabilidad de las lecturas M8. Integración real M5→M6→M7.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { PipelineCreativoService, LecturaCreativaService, MotorCreativoService, esPropuesta, type EntradaPipeline, type ProductorPieza } from '@soec/motor-creativo';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente } from '@soec/contenido';
import { PausaService, ALCANCE_GLOBAL } from '@soec/control';
import {
  OperacionService, LecturaOperativaService, ReconciliadorService, AdaptadorEjecucionSimulado,
  trabajoId as trabajoIdDe, claveEfecto, reservaId, clasificarM8, medibleM8, type EntradaOrden, type EscenarioSimulado, type PeticionEjecucion, type PuertoEjecucionSimulada, type ResultadoEjecucion, type ResultadoIntento,
} from '../src/index';

const attr: Attribution = { source: 'm7h', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
const FUTURO = '2026-09-01T10:00:00.000Z';
const EXEC = '2026-09-01T11:00:00.000Z';
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
class StoreFallaEvento implements EventStore {
  constructor(private readonly inner: EventStore, private readonly triggers: Map<string, number>) {}
  async append(c: RequestContext, s: string, v: number, events: readonly EventInput[]) {
    for (const e of events) { const r = this.triggers.get(e.type) ?? 0; if (r > 0) { this.triggers.set(e.type, r - 1); throw new Error(`fallo simulado: ${e.type}`); } }
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
async function prepararM6(store: InMemoryEventStore, c: RequestContext): Promise<number> {
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
function montarM7(store: EventStore, adaptador: PuertoEjecucionSimulada = new AdaptadorEjecucionSimulado(), opciones = {}) {
  const m5 = new MotorEstrategicoService(store); const creativa = new LecturaCreativaService(store, m5);
  const ordenes = new OperacionService(store, creativa, adaptador, opciones);
  return { store, ordenes, lectura: new LecturaOperativaService(store, ordenes), reconciliador: new ReconciliadorService(store, ordenes) };
}
const entradaOrden = (piezaVersion: number, over: Partial<EntradaOrden> = {}): EntradaOrden => ({
  capacidad: 'publicacion_social', pieza: { id: 'paq1', version: piezaVersion }, variante: { id: 'v1', version: 1 },
  programaId: 'prog1', entradaCalendarioId: 'ent1', contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog',
  instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', aprobacionRef: 'aprob', ...over,
});
async function hastaEnCola(ordenes: OperacionService, c: RequestContext, v: number, ordenId = 'orden1'): Promise<string> {
  await ordenes.crearOrden(c, ordenId, entradaOrden(v), attr, O);
  await ordenes.validar(c, ordenId, attr, O);
  await ordenes.programar(c, ordenId, O, attr, O);
  await ordenes.encolar(c, ordenId, attr, O);
  return trabajoIdDe('org-a', ordenId, 1);
}
const CLAVE = (v: number, ordenId = 'orden1') => claveEfecto('org-a', ordenId, { id: 'paq1', version: v }, { id: 'v1', version: 1 }, 'publicacion_social');

describe('M7 · ciclo presupuestario reserva→confirma/libera', () => {
  it('éxito ⇒ reserva CONFIRMADA y consumo una vez; agotar el tope ⇒ RECHAZADA sin reservar', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorEjecucionSimulado(), { presupuesto: { topeUnidades: 5, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    const t1 = await hastaEnCola(ordenes, c, v, 'orden1');
    expect((await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O)).estado).toBe('EJECUTADA_SIMULADA');
    expect((await ordenes.cargarReserva(c, reservaId('org-a', 'orden1', CLAVE(v)))).estado).toBe('CONFIRMADA');
    const t2 = await hastaEnCola(ordenes, c, v, 'orden2');
    expect((await ordenes.reclamarYEjecutar(c, t2, 'w1', EXEC, attr, O)).estado).toBe('FALLIDA');
    expect((await ordenes.cargarReserva(c, reservaId('org-a', 'orden2', CLAVE(v, 'orden2')))).existe).toBe(false);
  });

  it('fallo temporal ⇒ reserva LIBERADA (no queda comprometido)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { presupuesto: { topeUnidades: 100, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3, maxIntentos: 1 });
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    expect((await ordenes.cargarReserva(c, reservaId('org-a', 'orden1', CLAVE(v)))).estado).toBe('LIBERADA');
  });
});

describe('M7 · compensación de primera clase', () => {
  it('compensar ejecución exitosa ⇒ COMPENSADA + orden COMPENSADA; doble compensación converge', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    expect((await ordenes.compensar(c, 'orden1', 'reverso', attr, O)).estado).toBe('COMPENSADA');
    expect((await lectura.cargarOrden(c, 'orden1')).estado).toBe('COMPENSADA');
    expect((await ordenes.compensar(c, 'orden1', 'otra vez', attr, O)).estado).toBe('COMPENSADA');
  });

  it('compensar orden NO ejecutada ⇒ NO_APLICABLE (no toca la orden)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    expect((await ordenes.compensar(c, 'orden1', 'reverso', attr, O)).estado).toBe('NO_APLICABLE');
    expect((await lectura.cargarOrden(c, 'orden1')).estado).toBe('VALIDADA');
  });
});

describe('M7 · reconciliador exhaustivo', () => {
  it('orden PROGRAMADA sin trabajo ⇒ REPARADA (encola); dos reconciliadores concurrentes convergen', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura, reconciliador } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    const [r1] = await Promise.all([reconciliador.reconciliar(c, EXEC, attr, O), reconciliador.reconciliar(c, EXEC, attr, O)]);
    expect(r1.some((h) => h.clase === 'ORDEN_PROGRAMADA_SIN_TRABAJO')).toBe(true);
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('EN_COLA');
    expect((await lectura.cargarTrabajo(c, trabajoIdDe('org-a', 'orden1', 1))).existe).toBe(true);
  });
});

describe('M7 · fallos parciales por frontera (reparan sin duplicar el efecto lógico)', () => {
  const EXEC_LATE = '2026-09-01T13:00:00.000Z'; // lease vencido ⇒ el trabajo se puede re-reclamar
  const bordes = ['orden.creada', 'trabajo.encolado', 'reserva.reservada', 'efecto.aplicado', 'evidencia.operacional'];
  for (const tipo of bordes) {
    it(`fallo en '${tipo}' ⇒ reintento repara; efecto lógico exactamente una vez; orden ejecutada`, async () => {
      const inner = new InMemoryEventStore(); const c = ctx();
      const v = await prepararM6(inner, c);
      const store = new StoreFallaEvento(inner, new Map([[tipo, 1]]));
      const { ordenes, lectura, reconciliador } = montarM7(store);
      const reintentar = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
      await reintentar(() => ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O));
      await reintentar(() => ordenes.validar(c, 'orden1', attr, O));
      await reintentar(() => ordenes.programar(c, 'orden1', O, attr, O));
      await reintentar(() => ordenes.encolar(c, 'orden1', attr, O));
      const tid = trabajoIdDe('org-a', 'orden1', 1);
      try {
        await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
      } catch {
        // Fallo DENTRO del reclamo (orden queda EN_EJECUCION, lease tomado): la RECUPERACIÓN pasa por el
        // reconciliador (EN_EJECUCION→FALLIDA, lease vencido) + re-encola; luego se ejecuta el nuevo intento.
        await reconciliador.reconciliar(c, EXEC_LATE, attr, O);
        await ordenes.encolar(c, 'orden1', attr, O);
        await ordenes.reclamarYEjecutar(c, trabajoIdDe('org-a', 'orden1', 2), 'w1', EXEC_LATE, attr, O);
      }
      expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('EJECUTADA_SIMULADA');
      void lectura;
      // Efecto lógico EXACTAMENTE una vez (evento único bajo la clave lógica).
      expect((await inner.readStream(c, `efecto:org-a:${CLAVE(v)}`)).filter((e) => e.type === 'efecto.aplicado')).toHaveLength(1);
    });
  }
});

describe('M7 · replay frío integral e inmutabilidad M8', () => {
  it('reconstruye orden/reserva/compensación/evidencia idénticas desde un store nuevo (tras compensar)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    await ordenes.compensar(c, 'orden1', 'reverso', attr, O);
    const snap = JSON.parse(JSON.stringify(store.exportar())) as Record<string, RecordedEvent[]>;
    const frio = InMemoryEventStore.desdeInstantanea(snap);
    const ordFrio = new OperacionService(frio, new LecturaCreativaService(frio, new MotorEstrategicoService(frio)), new AdaptadorEjecucionSimulado());
    const lecFrio = new LecturaOperativaService(frio, ordFrio);
    expect((await lecFrio.cargarOrden(c, 'orden1')).estado).toBe('COMPENSADA');
    expect((await ordFrio.cargarReserva(c, reservaId('org-a', 'orden1', CLAVE(v)))).estado).toBe('CONFIRMADA');
    expect((await ordFrio.cargarCompensacion(c, `comp:org-a:orden1:${CLAVE(v)}`)).estado).toBe('COMPENSADA');
    expect((await lecFrio.listarEvidencias(c, 'orden1')).length).toBeGreaterThan(0);
  });

  it('los snapshots de M8 están congelados; mutarlos falla y una segunda lectura queda intacta', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    const evs = await lectura.listarEvidencias(c, 'orden1');
    expect(Object.isFrozen(evs)).toBe(true);
    expect(() => ((evs[0] as { version: number }).version = 999)).toThrow();
    expect((await lectura.listarEvidencias(c, 'orden1'))[0]?.resultado).toBe('EJECUTADA_SIMULADA');
  });
});

describe('M7 · reintento CANÓNICO (decidirRetry) con backoff y re-validación de gates', () => {
  const RETRY_1H = { habilitado: true, maxIntentos: 3, erroresReintentables: ['TIMEOUT'] as const, backoff: 'FIJO' as const, baseMs: 3600000, jitter: false, version: 'test' };
  const H1 = '2026-09-01T12:00:00.000Z'; // EXEC + 1h
  const H2 = '2026-09-01T13:00:00.000Z'; // EXEC + 2h

  it('backoff aplaza el reintento: el trabajo no es reclamable antes del vencimiento; tras el backoff re-valida M6 y ejecuta', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const adaptador = new AdaptadorMutable('FALLO_TEMPORAL');
    const { ordenes } = montarM7(store, adaptador, { politicaRetry: RETRY_1H });
    const t1 = await hastaEnCola(ordenes, c, v);
    expect((await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O)).estado).toBe('EN_COLA'); // re-encolada intento 2 con backoff
    const t2 = trabajoIdDe('org-a', 'orden1', 2);
    expect((await new LecturaOperativaService(store, ordenes).cargarTrabajo(c, t2)).disponibleDesde).toBe(H1);
    // Antes del vencimiento del backoff: NO reclamable.
    await expect(ordenes.reclamarYEjecutar(c, t2, 'w1', EXEC, attr, O)).rejects.toThrow();
    // Tras el backoff: el adaptador ya responde OK ⇒ re-valida gates y ejecuta.
    adaptador.escenario = 'EXITO';
    expect((await ordenes.reclamarYEjecutar(c, t2, 'w1', H2, attr, O)).estado).toBe('EJECUTADA_SIMULADA');
  });

  it('PAUSA durante el backoff impide el reintento (el gate PAUSA se re-evalúa al reclamar)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: { ...RETRY_1H, baseMs: 0 } });
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O); // re-encola intento 2 (disponible ya)
    await new PausaService(store).pausar(c, ALCANCE_GLOBAL, 'freno', 'director', attr, O);
    await expect(ordenes.reclamarYEjecutar(c, trabajoIdDe('org-a', 'orden1', 2), 'w1', EXEC, attr, O)).rejects.toThrow();
  });

  it('NO reintenta una clase NO reintentable aunque el adaptador declare reintentable=true ⇒ terminal + reserva LIBERADA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    // Adaptador adversarial: miente "reintentable:true" pero la clase normalizada es NO_AUTORIZADO (nunca reintentable).
    const adversario: PuertoEjecucionSimulada = { async ejecutar() { return { resultado: 'RECHAZADA', codigoError: 'NO_AUTORIZADO', reintentable: true, claseError: 'NO_AUTORIZADO', naturaleza: 'SIMULADA' }; } };
    const { ordenes } = montarM7(store, adversario, { politicaRetry: RETRY_1H, presupuesto: { topeUnidades: 100, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    const t1 = await hastaEnCola(ordenes, c, v);
    expect((await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O)).estado).toBe('FALLIDA');
    expect((await ordenes.cargarReserva(c, reservaId('org-a', 'orden1', CLAVE(v)))).estado).toBe('LIBERADA');
    expect((await new LecturaOperativaService(store, ordenes).cargarTrabajo(c, trabajoIdDe('org-a', 'orden1', 2))).existe).toBe(false); // no hay reintento
  });
});

describe('M7 · escenarios adversariales de gobierno (M6/FSM/idempotencia)', () => {
  const efectoVacio = async (store: EventStore, c: RequestContext, v: number) =>
    (await store.readStream(c, `efecto:org-a:${CLAVE(v)}`)).filter((e) => e.type === 'efecto.aplicado').length === 0;

  it('variante revocada ⇒ la orden NO puede crearse (gate M6 la excluye de las piezas aprobadas)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    await new AprobacionService(store).decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O);
    const { ordenes } = montarM7(store);
    await expect(ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O)).rejects.toThrow();
  });

  it('variante revocada estando la orden EN_COLA ⇒ el gate M6 rechaza en el reclamo; NO hay efecto', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await new AprobacionService(store).decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O);
    const st = await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    expect(['FALLIDA', 'OBSOLETA']).toContain(st.estado);
    expect(await efectoVacio(store, c, v)).toBe(true);
  });

  it('entrada de calendario CANCELADA (defensa en profundidad) ⇒ el gate M6 rechaza; NO hay efecto', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    // La FSM del calendario no expone cancelar; se inyecta el estado como corrupción/capacidad futura: el gate debe resistir.
    const s = 'calendario:org-a:prog1';
    const ver = await store.currentVersion(c, s);
    await store.append(c, s, ver, [{ type: 'cal.entrada_transicionada', payload: { entradaId: 'ent1', estado: 'CANCELADA' }, attribution: attr, occurredAt: O }]);
    const st = await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    expect(['FALLIDA', 'OBSOLETA']).toContain(st.estado);
    expect(await efectoVacio(store, c, v)).toBe(true);
  });

  it('orden CANCELADA (terminal) no puede reprogramarse ni re-encolarse (FSM)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    await ordenes.cancelar(c, 'orden1', 'stop', attr, O);
    await expect(ordenes.programar(c, 'orden1', O, attr, O)).resolves.toMatchObject({ estado: 'CANCELADA' }); // no-op idempotente
    await expect(ordenes.encolar(c, 'orden1', attr, O)).rejects.toThrow();
  });

  it('reclamar tras CANCELAR ⇒ no hay falso éxito: la orden queda CANCELADA y sin efecto', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.cancelar(c, 'orden1', 'stop', attr, O);
    expect((await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O)).estado).toBe('CANCELADA');
    expect(await efectoVacio(store, c, v)).toBe(true);
  });

  it('la evidencia NO contiene secretos/cuerpos y su naturaleza es SIMULADA (nunca REAL)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    const evs = await lectura.listarEvidencias(c, 'orden1');
    const texto = JSON.stringify(evs);
    expect(texto).not.toMatch(/env:OP|secreto|password|Bearer|stack/i);
    expect(texto).not.toContain('REAL');
  });
});

describe('M7 · clasificación semántica para M8', () => {
  const clasDe = async (lectura: LecturaOperativaService, c: RequestContext, ordenId: string) =>
    (await lectura.listarOrdenes(c)).find((x) => x.ordenId === ordenId)!;

  it('ejecutada con evidencia ⇒ COMPLETA y MEDIBLE', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const t1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O);
    const m8 = await clasDe(lectura, c, 'orden1');
    expect(m8.clasificacion).toBe('COMPLETA');
    expect(m8.medible).toBe(true);
  });

  it('cancelada / compensada / fallida / expirada ⇒ clasificadas y NO medibles', async () => {
    // CANCELADA + EXPIRADA (servicio con ventana de expiración)
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const svc = montarM7(store, new AdaptadorMutable('EXITO'), { ventanaExpiracionMs: 1000 });
    const tC = await hastaEnCola(svc.ordenes, c, v, 'ordenC');
    void tC; await svc.ordenes.cancelar(c, 'ordenC', 'stop', attr, O);
    await svc.ordenes.crearOrden(c, 'ordenE', entradaOrden(v, { instantePlanificado: '2026-07-01T00:00:00.000Z' }), attr, O);
    await svc.ordenes.validar(c, 'ordenE', attr, O);
    await svc.ordenes.programar(c, 'ordenE', O, attr, O);
    // FALLIDA terminal (permanente) — store propio SIN expiración para no cruzar gates
    const sF = new InMemoryEventStore(); const cF = ctx();
    const vF = await prepararM6(sF, cF);
    const svcF = montarM7(sF, new AdaptadorMutable('FALLO_PERMANENTE'), { maxIntentos: 1 });
    const tF = await hastaEnCola(svcF.ordenes, cF, vF, 'ordenF');
    await svcF.ordenes.reclamarYEjecutar(cF, tF, 'w1', EXEC, attr, O);
    // COMPENSADA — store propio
    const sK = new InMemoryEventStore(); const cK = ctx();
    const vK = await prepararM6(sK, cK);
    const svcK = montarM7(sK);
    const tK = await hastaEnCola(svcK.ordenes, cK, vK, 'ordenK');
    await svcK.ordenes.reclamarYEjecutar(cK, tK, 'w1', EXEC, attr, O);
    await svcK.ordenes.compensar(cK, 'ordenK', 'reverso', attr, O);

    expect((await clasDe(svc.lectura, c, 'ordenC')).clasificacion).toBe('CANCELADA');
    expect((await clasDe(svc.lectura, c, 'ordenE')).clasificacion).toBe('EXPIRADA');
    expect((await clasDe(svcF.lectura, cF, 'ordenF')).clasificacion).toBe('FALLIDA');
    expect((await clasDe(svcK.lectura, cK, 'ordenK')).clasificacion).toBe('COMPENSADA');
    expect((await clasDe(svc.lectura, c, 'ordenC')).medible).toBe(false);
  });

  it('ventana vencida al reclamar (orden ya EN_EJECUCION) ⇒ EXPIRADA sin crash ni efecto', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('EXITO'), { ventanaExpiracionMs: 1000 });
    const t1 = await hastaEnCola(ordenes, c, v); // instante planificado 10:00; se reclama a las 11:00 (fuera de ventana)
    expect((await ordenes.reclamarYEjecutar(c, t1, 'w1', EXEC, attr, O)).estado).toBe('EXPIRADA');
    expect((await store.readStream(c, `efecto:org-a:${CLAVE(v)}`)).filter((e) => e.type === 'efecto.aplicado')).toHaveLength(0);
  });

  it('clasificarM8 es total y determinista sobre los 11 estados (incluye PARCIAL y NO_RECONCILIADA)', () => {
    expect(clasificarM8('EJECUTADA_SIMULADA', true)).toBe('COMPLETA');
    expect(clasificarM8('EJECUTADA_SIMULADA', false)).toBe('PARCIAL'); // efecto sin evidencia: anómala
    expect(clasificarM8('EN_EJECUCION', false)).toBe('NO_RECONCILIADA');
    expect(clasificarM8('OBSOLETA', false)).toBe('OBSOLETA');
    expect(clasificarM8('EN_COLA', false)).toBe('EN_PROCESO');
    expect(medibleM8('COMPLETA')).toBe(true);
    expect(medibleM8('PARCIAL')).toBe(false);
    expect(medibleM8('NO_RECONCILIADA')).toBe(false);
  });
});
