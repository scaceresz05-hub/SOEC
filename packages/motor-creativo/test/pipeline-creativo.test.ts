/**
 * @soec/motor-creativo · tests · PIPELINE CREATIVO gobernado (M6) — cierre focalizado.
 * Integración real M5→M6→M3 en dos fases (componer → aprobación humana → calendarizar). Prueba: gate de
 * vigencia transversal, obsolescencia materializada sin autoridades contradictorias, aprobación no
 * heredable, fallo parcial reparable, replay frío, y listarPiezasAprobadas (solo vigentes+aprobadas).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { EstrategiaCreativaArtefactoService, AprobacionService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
import type { ContenidoBrief, PayloadProducido, PiezaFuente } from '@soec/contenido';
import {
  PipelineCreativoService,
  LecturaCreativaService,
  MotorCreativoService,
  esPropuesta,
  type EntradaPipeline,
  type ProductorPieza,
} from '../src/index';

const attr: Attribution = { source: 'm6', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
const FUTURO = '2026-09-01T10:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

const piezaLista: PiezaFuente = { version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida' };
const productorListo: ProductorPieza = {
  async producir(_ctx, p): Promise<PayloadProducido> {
    return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaLista, historialPiezas: [piezaLista], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' };
  },
};

/** Store que falla un número de veces en el append a un stream dado (para fallo parcial reparable). */
class StoreFalloUnaVez implements EventStore {
  constructor(private readonly inner: EventStore, private readonly fallos: Map<string, number>) {}
  async append(ctx: RequestContext, streamId: string, expectedVersion: number, events: readonly EventInput[]) {
    const rem = this.fallos.get(streamId) ?? 0;
    if (rem > 0) { this.fallos.set(streamId, rem - 1); throw new Error(`fallo simulado en ${streamId}`); }
    return this.inner.append(ctx, streamId, expectedVersion, events);
  }
  readStream(ctx: RequestContext, s: string): Promise<readonly RecordedEvent[]> { return this.inner.readStream(ctx, s); }
  reconstructAt(ctx: RequestContext, s: string, at: string): Promise<readonly RecordedEvent[]> { return this.inner.reconstructAt(ctx, s, at); }
  currentVersion(ctx: RequestContext, s: string): Promise<number> { return this.inner.currentVersion(ctx, s); }
}

function montar(store: EventStore = new InMemoryEventStore()) {
  const m5 = new MotorEstrategicoService(store);
  const artefacto = new EstrategiaCreativaArtefactoService(store);
  const aprobacion = new AprobacionService(store);
  const pipeline = new PipelineCreativoService(store, m5, { factory: productorListo });
  const lectura = new LecturaCreativaService(store, m5);
  const motor = new MotorCreativoService(store, m5);
  return { store, m5, artefacto, aprobacion, pipeline, lectura, motor };
}

async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion, sostener: boolean) {
  await m5.registrar(c, id, clase, `afirmación ${id}`, attr, O);
  if (sostener) await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'dato', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}

const contenidoArt: ContenidoArtefacto = { programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1', concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [], pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1' };

const brief = (over: Partial<ContenidoBrief> = {}): ContenidoBrief => ({ organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act', audiencia: 'pymes', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación', propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención', restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01', ...over });

const entrada = (over: Partial<EntradaPipeline> = {}): EntradaPipeline => ({
  contextoId: 'ctx1', roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }],
  briefId: 'brief1', brief: brief(), territorioId: 'terr1', estrategiaCreativaId: 'estcr1',
  mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }],
  validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false },
  paqueteId: 'paq1', formato: 'articulo', canal: 'blog',
  variante: { varianteId: 'v1', hipotesis: 'un gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] },
  calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' },
  ...over,
});

async function sembrar(m5: MotorEstrategicoService, motor: MotorCreativoService, artefacto: EstrategiaCreativaArtefactoService, c: RequestContext) {
  await afirmar(m5, c, 'icp', 'ICP', true);
  await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR', true);
  await afirmar(m5, c, 'obj', 'OBJETIVO', true);
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'desorden', tension: 'x', beneficio: 'orden', prueba: 'casos', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, attr, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
  await artefacto.establecer(c, 'estcr1', contenidoArt, attr, O);
}
async function aprobar(aprobacion: AprobacionService, c: RequestContext, piezaVersion: number) {
  await aprobacion.decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: piezaVersion, decision: 'APROBADA' }, attr, O);
  await aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
}

describe('pipeline · dos fases con aprobación humana', () => {
  it('componer deja PENDIENTE_APROBACION (no calendariza); calendarizar antes de aprobar se abstiene', async () => {
    const { m5, artefacto, pipeline, lectura, motor } = montar();
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    const r = await pipeline.componer(c, entrada(), attr, O);
    expect(esPropuesta(r)).toBe(true);
    if (!esPropuesta(r)) return;
    expect(r.valor.estado).toBe('PENDIENTE_APROBACION');
    expect(r.valor.entradaCalendarioId).toBeNull();
    // Sin aprobación humana, calendarizar NO crea entrada.
    const sinAprob = await pipeline.calendarizar(c, entrada(), attr, O);
    expect(sinAprob.tipo).toBe('ABSTENCION');
    expect((await lectura.cargarCalendario(c, 'prog1')).existe).toBe(false);
  });

  it('tras aprobación humana de pieza y variante, calendarizar crea la entrada (gobernanza cerrada)', async () => {
    const { m5, artefacto, aprobacion, pipeline, lectura, motor } = montar();
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    const r = await pipeline.componer(c, entrada(), attr, O);
    if (!esPropuesta(r)) throw new Error('esperaba propuesta');
    await aprobar(aprobacion, c, r.valor.piezaVersionParaAprobar);
    const cal = await pipeline.calendarizar(c, entrada(), attr, O);
    expect(esPropuesta(cal)).toBe(true);
    if (esPropuesta(cal)) expect(cal.valor.estado).toBe('CALENDARIZADO');
    expect((await lectura.cargarCalendario(c, 'prog1')).entradas[0]?.entradaId).toBe('ent1');
    // La pieza aparece en la lista para M7 (aprobada + vigente).
    const aprobadas = await lectura.listarPiezasAprobadas(c);
    expect(aprobadas.map((p) => p.paqueteId)).toContain('paq1');
    expect(aprobadas[0]?.trazabilidad[0]?.afirmacionId).toBe('pv');
  });
});

describe('pipeline · obsolescencia como gate único (autoridad sin contradicción)', () => {
  it('un cambio en M5 tras aprobar ⇒ calendarizar se abstiene, materializa OBSOLETO y la pieza sale de la lista', async () => {
    const { m5, artefacto, aprobacion, pipeline, lectura, motor } = montar();
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    const r = await pipeline.componer(c, entrada(), attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await aprobar(aprobacion, c, r.valor.piezaVersionParaAprobar);
    expect((await lectura.listarPiezasAprobadas(c)).length).toBe(1);
    // M5 cambia: la afirmación de respaldo sube de versión.
    await m5.agregarEvidencia(c, 'pv', { evidenciaId: 'pv-e2', enunciado: 'más', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    const cal = await pipeline.calendarizar(c, entrada(), attr, O);
    expect(cal.tipo).toBe('ABSTENCION');
    if (cal.tipo === 'ABSTENCION') expect(cal.abstencion.motivo).toBe('CONOCIMIENTO_OBSOLETO');
    // Materialización coherente: la pieza y la estrategia quedan OBSOLETO; la lista la excluye.
    expect((await lectura.cargarPieza(c, 'paq1')).pieza?.vigencia).toBe('OBSOLETO');
    expect((await lectura.cargarEstrategia(c, 'estcr1')).artefacto?.estadoGobernanza).toBe('OBSOLETO');
    expect(await lectura.listarPiezasAprobadas(c)).toEqual([]);
    expect((await lectura.cargarCalendario(c, 'prog1')).existe).toBe(false);
  });
});

describe('pipeline · fallo parcial reparable e idempotencia', () => {
  it('falla el alta de la variante, se reintenta y repara sin duplicar la pieza ni la variante', async () => {
    const inner = new InMemoryEventStore();
    const store = new StoreFalloUnaVez(inner, new Map([['ab:org-a:paq1', 1]]));
    const { m5, artefacto, pipeline, lectura, motor } = montar(store);
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    await expect(pipeline.componer(c, entrada(), attr, O)).rejects.toThrow(); // falla en la variante
    // La pieza ya existe; la variante no. Reintento idempotente repara solo lo faltante.
    const r2 = await pipeline.componer(c, entrada(), attr, O);
    expect(esPropuesta(r2)).toBe(true);
    expect((await lectura.cargarExperimento(c, 'paq1')).variantes).toHaveLength(1);
    expect((await lectura.listarPiezasAprobadas(c)).length).toBe(0); // aún sin aprobar
    expect((await lectura.cargarPieza(c, 'paq1')).pieza?.trazabilidad).toHaveLength(1); // gobernada una sola vez
  });
});

describe('pipeline · replay frío (reconstrucción desde el log, sin cachés de proceso)', () => {
  it('un servicio de lectura NUEVO reconstruye idéntico estado desde el mismo store', async () => {
    const store = new InMemoryEventStore();
    const { m5, artefacto, aprobacion, pipeline } = montar(store);
    const c = ctx();
    await sembrar(m5, motor(store), artefacto, c);
    const r = await pipeline.componer(c, entrada(), attr, O);
    if (!esPropuesta(r)) throw new Error('propuesta');
    await aprobar(aprobacion, c, r.valor.piezaVersionParaAprobar);
    await pipeline.calendarizar(c, entrada(), attr, O);
    // Instancia NUEVA de servicio (sin estado propio): debe reconstruir lo mismo desde el log.
    const frio = new LecturaCreativaService(store, new MotorEstrategicoService(store));
    expect((await frio.cargarPieza(c, 'paq1')).pieza?.formato).toBe('articulo');
    expect((await frio.cargarCalendario(c, 'prog1')).entradas[0]?.entradaId).toBe('ent1');
    expect((await frio.listarPiezasAprobadas(c)).map((p) => p.paqueteId)).toEqual(['paq1']);
    expect(await frio.vigenciaContexto(c, 'ctx1')).toBe('VIGENTE');
  });
});

describe('pipeline · aislamiento multi-tenant y gates de composición', () => {
  it('org B no puede completar el pipeline de org A (su M5 no sostiene el conocimiento)', async () => {
    const { m5, artefacto, pipeline, motor } = montar();
    await sembrar(m5, motor, artefacto, ctx('org-a'));
    const r = await pipeline.componer(ctx('org-b'), entrada(), attr, O);
    expect(r.tipo).toBe('ABSTENCION'); // en org-b no existen las afirmaciones → contexto no evaluable
  });

  it('texto con afirmación de riesgo no respaldada ⇒ abstención, sin pieza', async () => {
    const { m5, artefacto, pipeline, lectura, motor } = montar();
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    const r = await pipeline.componer(c, entrada({ validacion: { cuerpo: 'El mejor software con 50% de descuento garantizado.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false } }), attr, O);
    expect(r.tipo).toBe('ABSTENCION');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });
});

describe('pipeline · gates de abstención tipada en componer (nunca produce artefactos inválidos)', () => {
  async function correr(seed: (m5: MotorEstrategicoService, motor: MotorCreativoService, art: EstrategiaCreativaArtefactoService, c: RequestContext) => Promise<void>, e: EntradaPipeline) {
    const { m5, artefacto, pipeline, lectura, motor } = montar();
    const c = ctx();
    await seed(m5, motor, artefacto, c);
    return { r: await pipeline.componer(c, e, attr, O), lectura, c };
  }
  const territorio = (motor: MotorCreativoService, c: RequestContext) => motor.registrarTerritorio(c, 'terr1', { tesis: 'x', audienciaRef: 'icp', problemaCentral: '', tension: '', beneficio: '', prueba: '', riesgos: [], compatibilidadMarca: 'C' }, attr, O);

  it('ICP no sostenido ⇒ FALTA_AUDIENCIA, sin pieza', async () => {
    const { r, lectura, c } = await correr(async (m5, m, art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', false); await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', true); await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await territorio(m, cc); await art.establecer(cc, 'estcr1', contenidoArt, attr, O);
    }, entrada());
    expect(r.tipo === 'ABSTENCION' && r.abstencion.motivo).toBe('FALTA_AUDIENCIA');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });

  it('propuesta de valor no sostenida ⇒ FALTA_PROPUESTA_VALOR', async () => {
    const { r } = await correr(async (m5, m, art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', true); await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', false); await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await territorio(m, cc); await art.establecer(cc, 'estcr1', contenidoArt, attr, O);
    }, entrada());
    expect(r.tipo === 'ABSTENCION' && r.abstencion.motivo).toBe('FALTA_PROPUESTA_VALOR');
  });

  it('mensaje cuyo tipo no autoriza la clase de la afirmación ⇒ abstención', async () => {
    const { r } = await correr(sembrar, entrada({ mensajes: [{ mensajeId: 'msg1', tipo: 'PRUEBA', texto: 'probado', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }] }));
    expect(r.tipo).toBe('ABSTENCION');
  });

  it('estrategia inexistente ⇒ SIN_AFIRMACION_PERMITIDA', async () => {
    const { r } = await correr(async (m5, m, _art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', true); await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', true); await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await territorio(m, cc); await m.agregarEvidenciaTerritorio(cc, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
    }, entrada());
    expect(r.tipo === 'ABSTENCION' && r.abstencion.motivo).toBe('SIN_AFIRMACION_PERMITIDA');
  });

  it('brief incompleto (sin audiencia) ⇒ abstención, sin pieza', async () => {
    const { r, lectura, c } = await correr(sembrar, entrada({ brief: brief({ audiencia: '' }) }));
    expect(r.tipo).toBe('ABSTENCION');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });
});

// helper: crea un MotorCreativoService con un M5 sobre el mismo store (para sembrar en replay frío)
function motor(store: EventStore): MotorCreativoService {
  return new MotorCreativoService(store, new MotorEstrategicoService(store));
}
