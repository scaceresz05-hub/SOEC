/**
 * @soec/motor-creativo · tests · CIERRE M6 — recuperación, concurrencia, replay frío e inmutabilidad.
 * Cubre el dictamen de correcciones focalizadas 2: matriz de fallos parciales por frontera con conteo de
 * eventos (sin duplicados), reintentos concurrentes que convergen, solicitud de aprobación canónica,
 * replay desde un store NUEVO reconstruido de un log serializado, e inmutabilidad en runtime.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto, experimentoABStreamId, calendarioStreamId } from '@soec/estrategia-creativa';
import { type ContenidoBrief, type PayloadProducido, type PiezaFuente, EVENTOS_PAQ, paqueteStreamId } from '@soec/contenido';
import {
  PipelineCreativoService, LecturaCreativaService, MotorCreativoService, GobernanzaCreativaService,
  esPropuesta, indicePiezasStreamId, solicitudStreamId, type EntradaPipeline, type ProductorPieza,
} from '../src/index';

const attr: Attribution = { source: 'm6', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
const FUTURO = '2026-09-01T10:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}
const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productor: ProductorPieza = { async producir(_c, p): Promise<PayloadProducido> { return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' }; } };

/** Store que falla `n` veces cuando el lote contiene un evento de un tipo dado (fallos por frontera). */
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

function montar(store: EventStore) {
  const m5 = new MotorEstrategicoService(store);
  return { store, m5, artefacto: new EstrategiaCreativaArtefactoService(store), aprobacion: new AprobacionService(store), gobernanza: new GobernanzaCreativaService(store, m5), pipeline: new PipelineCreativoService(store, m5, { factory: productor }), lectura: new LecturaCreativaService(store, m5), motor: new MotorCreativoService(store, m5) };
}
async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion) {
  await m5.registrar(c, id, clase, `af ${id}`, attr, O);
  await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'd', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}
const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };
const brief: ContenidoBrief = { organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01' };
const entrada: EntradaPipeline = { contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }], briefId: 'brief1', brief, territorioId: 'terr1', estrategiaCreativaId: 'estcr1', mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }], validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false }, paqueteId: 'paq1', formato: 'articulo', canal: 'blog', variante: { varianteId: 'v1', hipotesis: 'gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] }, calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' } };
async function sembrar(store: EventStore, c: RequestContext) {
  const m5 = new MotorEstrategicoService(store); const motor = new MotorCreativoService(store, m5);
  await afirmar(m5, c, 'icp', 'ICP'); await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR'); await afirmar(m5, c, 'obj', 'OBJETIVO');
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'd', tension: 'x', beneficio: 'orden', prueba: 'c', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, attr, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
  await new EstrategiaCreativaArtefactoService(store).establecer(c, 'estcr1', contenidoArt, attr, O);
}
async function cuenta(store: EventStore, c: RequestContext, streamId: string, tipo: string): Promise<number> {
  return (await store.readStream(c, streamId)).filter((e) => e.type === tipo).length;
}
async function aprobar(aprobacion: AprobacionService, c: RequestContext, piezaVersion: number) {
  await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: piezaVersion, decision: 'APROBADA' }, attr, O);
  await aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
}

// ── A · Matriz de fallos parciales por frontera (fallo → reparación → no-op idempotente) ────────────
describe('A · fallos parciales por frontera: reparan sin duplicar (conteo de eventos)', () => {
  const fronteras: { nombre: string; tipoFalla: string; stream: (c: RequestContext) => string; tipoEvento: string }[] = [
    { nombre: 'producción de pieza', tipoFalla: EVENTOS_PAQ.producido, stream: () => paqueteStreamId('paq1'), tipoEvento: EVENTOS_PAQ.producido },
    { nombre: 'vinculación de gobernanza', tipoFalla: EVENTOS_PAQ.gobernanza, stream: () => paqueteStreamId('paq1'), tipoEvento: EVENTOS_PAQ.gobernanza },
    { nombre: 'índice de piezas', tipoFalla: 'creativo-pieza-indice.registrada', stream: (c) => indicePiezasStreamId(String(c.organizationId)), tipoEvento: 'creativo-pieza-indice.registrada' },
    { nombre: 'variante A/B', tipoFalla: 'ab.variante_agregada', stream: () => experimentoABStreamId('org-a', 'paq1'), tipoEvento: 'ab.variante_agregada' },
    { nombre: 'solicitud de aprobación', tipoFalla: 'creativo-solicitud.registrada', stream: (c) => solicitudStreamId(String(c.organizationId), 'PIEZA', 'paq1'), tipoEvento: 'creativo-solicitud.registrada' },
  ];

  for (const f of fronteras) {
    it(`frontera: ${f.nombre}`, async () => {
      const inner = new InMemoryEventStore();
      const store = new StoreFallaEvento(inner, new Map([[f.tipoFalla, 1]]));
      const c = ctx();
      await sembrar(inner, c); // la siembra usa el store interno (sin fallos)
      const { pipeline, lectura } = montar(store);
      await expect(pipeline.componer(c, entrada, attr, O)).rejects.toThrow(); // estado parcial
      const r2 = await pipeline.componer(c, entrada, attr, O); // reparación
      expect(esPropuesta(r2)).toBe(true);
      await pipeline.componer(c, entrada, attr, O); // tercer intento: no-op idempotente
      // Exactamente UN evento en la frontera reparada (sin duplicados) tras dos intentos exitosos.
      expect(await cuenta(inner, c, f.stream(c), f.tipoEvento)).toBe(1);
      // La cadena converge: pieza gobernada una sola vez, en el índice una sola vez.
      expect((await lectura.cargarPieza(c, 'paq1')).pieza?.trazabilidad).toHaveLength(1);
      expect((await lectura.listarPiezasAprobadas(c)).length).toBe(0); // aún sin aprobar
    });
  }

  it('frontera: append de calendario (en fase 2, tras aprobación)', async () => {
    const inner = new InMemoryEventStore();
    const store = new StoreFallaEvento(inner, new Map([['cal.entrada_agregada', 1]]));
    const c = ctx();
    await sembrar(inner, c);
    const { pipeline, aprobacion } = montar(store);
    const r = await pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await aprobar(aprobacion, c, r.valor.piezaVersionParaAprobar);
    await expect(pipeline.calendarizar(c, entrada, attr, O)).rejects.toThrow(); // falla el append de entrada
    const cal = await pipeline.calendarizar(c, entrada, attr, O); // reparación
    expect(esPropuesta(cal)).toBe(true);
    await pipeline.calendarizar(c, entrada, attr, O); // no-op idempotente
    expect(await cuenta(inner, c, calendarioStreamId('org-a', 'prog1'), 'cal.entrada_agregada')).toBe(1);
  });
});

// ── B · Solicitud de aprobación canónica ───────────────────────────────────────────────────────────
describe('B · solicitud de aprobación canónica (determinista, idempotente, PENDIENTE→APROBADA→OBSOLETA)', () => {
  it('componer emite una solicitud PENDIENTE con id determinista; no se duplica; pasa a APROBADA y a OBSOLETA', async () => {
    const store = new InMemoryEventStore();
    const c = ctx();
    await sembrar(store, c);
    const { pipeline, aprobacion, lectura } = montar(store);
    const r = await pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    const v = r.valor.piezaVersionParaAprobar;
    expect(r.valor.solicitudPiezaId).toBe(`sol:org-a:PIEZA:paq1:v${v}`);
    expect(await lectura.estadoSolicitudPieza(c, 'paq1', v)).toBe('PENDIENTE');
    await pipeline.componer(c, entrada, attr, O); // reintento: no duplica la solicitud
    expect(await cuenta(store, c, solicitudStreamId('org-a', 'PIEZA', 'paq1'), 'creativo-solicitud.registrada')).toBe(1);
    await aprobar(aprobacion, c, v);
    expect(await lectura.estadoSolicitudPieza(c, 'paq1', v)).toBe('APROBADA');
    // Cambia M5 y la pieza se vuelve obsoleta (sube su versión): la solicitud de la versión vieja queda OBSOLETA.
    await new MotorEstrategicoService(store).agregarEvidencia(c, 'pv', { evidenciaId: 'pv-e2', enunciado: 'm', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    await pipeline.calendarizar(c, entrada, attr, O); // materializa obsolescencia (sube versión de la pieza)
    expect(await lectura.estadoSolicitudPieza(c, 'paq1', v)).toBe('OBSOLETA');
  });
});

// ── C · Replay FRÍO desde un store NUEVO reconstruido de un log serializado ─────────────────────────
describe('C · replay frío (store nuevo desde log serializado; sin referencias del proceso anterior)', () => {
  it('reconstruye idéntico contexto/brief/estrategia/pieza/variante/calendario/obsolescencia/listados', async () => {
    const original = new InMemoryEventStore();
    const c = ctx();
    await sembrar(original, c);
    const caliente = montar(original);
    const r = await caliente.pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await aprobar(caliente.aprobacion, c, r.valor.piezaVersionParaAprobar);
    await caliente.pipeline.calendarizar(c, entrada, attr, O);
    const listaCaliente = await caliente.lectura.listarPiezasAprobadas(c);

    // Serializa el log (round-trip JSON: ninguna referencia compartida) y reconstruye un store NUEVO.
    const snapshot = JSON.parse(JSON.stringify(original.exportar())) as Record<string, RecordedEvent[]>;
    const frio = InMemoryEventStore.desdeInstantanea(snapshot);
    const lecturaFria = new LecturaCreativaService(frio, new MotorEstrategicoService(frio));

    expect((await lecturaFria.cargarPieza(c, 'paq1')).pieza?.formato).toBe('articulo');
    expect((await lecturaFria.cargarCalendario(c, 'prog1')).entradas[0]?.entradaId).toBe('ent1');
    expect((await lecturaFria.cargarEstrategia(c, 'estcr1')).artefacto?.estadoGobernanza).toBe('VIGENTE');
    expect(await lecturaFria.vigenciaContexto(c, 'ctx1')).toBe('VIGENTE');
    expect(JSON.stringify(await lecturaFria.listarPiezasAprobadas(c))).toBe(JSON.stringify(listaCaliente));
  });
});

// ── D · Concurrencia reparadora e idempotencia ──────────────────────────────────────────────────────
describe('D · concurrencia: convergen sin duplicar', () => {
  it('dos calendarizaciones concurrentes ⇒ una sola entrada', async () => {
    const store = new InMemoryEventStore();
    const c = ctx();
    await sembrar(store, c);
    const { pipeline, aprobacion } = montar(store);
    const r = await pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await aprobar(aprobacion, c, r.valor.piezaVersionParaAprobar);
    await Promise.allSettled([pipeline.calendarizar(c, entrada, attr, O), pipeline.calendarizar(c, entrada, attr, O)]);
    expect(await cuenta(store, c, calendarioStreamId('org-a', 'prog1'), 'cal.entrada_agregada')).toBe(1);
  });

  it('dos evaluaciones de vigencia concurrentes sobre una pieza obsoleta ⇒ un solo evento de obsolescencia', async () => {
    const store = new InMemoryEventStore();
    const c = ctx();
    await sembrar(store, c);
    const { pipeline, gobernanza } = montar(store);
    const r = await pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await new MotorEstrategicoService(store).agregarEvidencia(c, 'pv', { evidenciaId: 'pv-e2', enunciado: 'm', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    const refs = [{ afirmacionId: 'pv', version: 2 }];
    await Promise.allSettled([
      gobernanza.evaluarVigenciaCreativa(c, refs, { paqueteId: 'paq1' }, attr, O),
      gobernanza.evaluarVigenciaCreativa(c, refs, { paqueteId: 'paq1' }, attr, O),
    ]);
    expect(await cuenta(store, c, paqueteStreamId('paq1'), EVENTOS_PAQ.obsoleta)).toBe(1);
  });

  it('decisión humana repetida ⇒ una sola aprobación (idempotente)', async () => {
    const store = new InMemoryEventStore();
    const c = ctx();
    const { aprobacion } = montar(store);
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: 3, decision: 'APROBADA' }, attr, O);
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: 3, decision: 'APROBADA' }, attr, O);
    expect(await cuenta(store, c, `aprobacion:org-a:PIEZA:paq1`, 'aprobacion.decidida')).toBe(1);
  });
});

// ── E · Inmutabilidad en runtime ────────────────────────────────────────────────────────────────────
describe('E · inmutabilidad runtime de los snapshots de LecturaCreativa', () => {
  it('mutar el snapshot de listarPiezasAprobadas falla y no altera una segunda lectura', async () => {
    const store = new InMemoryEventStore();
    const c = ctx();
    await sembrar(store, c);
    const { pipeline, aprobacion, lectura } = montar(store);
    const r = await pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await aprobar(aprobacion, c, r.valor.piezaVersionParaAprobar);
    const lista = await lectura.listarPiezasAprobadas(c);
    expect(Object.isFrozen(lista)).toBe(true);
    expect(() => (lista[0]!.referenciasM5 as { afirmacionId: string; version: number }[]).push({ afirmacionId: 'x', version: 9 })).toThrow();
    expect(() => ((lista[0] as { version: number }).version = 999)).toThrow();
    // Segunda lectura intacta.
    const lista2 = await lectura.listarPiezasAprobadas(c);
    expect(lista2[0]!.referenciasM5).toHaveLength(lista[0]!.referenciasM5.length);
    expect(lista2[0]!.version).toBe(r.valor.piezaVersionParaAprobar);
  });
});

// ── F · Contrato M7: listarPiezasAprobadas excluye lo no ejecutable ─────────────────────────────────
describe('F · listarPiezasAprobadas excluye no-ejecutables', () => {
  async function base() {
    const store = new InMemoryEventStore();
    const c = ctx();
    await sembrar(store, c);
    const m = montar(store);
    const r = await m.pipeline.componer(c, entrada, attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    return { ...m, c, version: r.valor.piezaVersionParaAprobar };
  }

  it('aprobación de OTRA versión ⇒ excluida', async () => {
    const { aprobacion, lectura, c, version } = await base();
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: version + 7, decision: 'APROBADA' }, attr, O);
    expect(await lectura.listarPiezasAprobadas(c)).toEqual([]);
  });

  it('aprobación revocada (RECHAZADA posterior) ⇒ excluida', async () => {
    const { aprobacion, lectura, c, version } = await base();
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: version, decision: 'APROBADA' }, attr, O);
    expect((await lectura.listarPiezasAprobadas(c)).length).toBe(1);
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: version, decision: 'RECHAZADA' }, attr, O);
    expect(await lectura.listarPiezasAprobadas(c)).toEqual([]);
  });

  it('pieza RETIRADA ⇒ excluida', async () => {
    const { store, aprobacion, lectura, c, version } = await base();
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: version, decision: 'APROBADA' }, attr, O);
    // Retiro directo del paquete (evento canónico de @soec/contenido).
    const st = await store.readStream(c, paqueteStreamId('paq1'));
    await store.append(c, paqueteStreamId('paq1'), st.length, [{ type: EVENTOS_PAQ.retirado, payload: { motivo: 'descartada' }, attribution: attr, occurredAt: O }]);
    expect(await lectura.listarPiezasAprobadas(c)).toEqual([]);
  });

  it('pieza OBSOLETA (M5 cambió) ⇒ excluida aunque estuviera aprobada', async () => {
    const { store, aprobacion, lectura, c, version } = await base();
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: version, decision: 'APROBADA' }, attr, O);
    await new MotorEstrategicoService(store).agregarEvidencia(c, 'pv', { evidenciaId: 'pv-e2', enunciado: 'm', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    expect(await lectura.listarPiezasAprobadas(c)).toEqual([]);
  });

  it('cross-tenant: org B no ve piezas de org A', async () => {
    const { aprobacion, lectura, c, version } = await base();
    await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: version, decision: 'APROBADA' }, attr, O);
    expect(await lectura.listarPiezasAprobadas(ctx('org-b'))).toEqual([]);
  });
});
