/**
 * @soec/motor-creativo · tests · PIPELINE CREATIVO end-to-end (M6). Integración real M5→M6→M3.
 * Conecta contexto→brief→territorio→estrategia→mensajes→pieza→A/B→calendario y prueba los gates de
 * abstención y gobernanza. La producción de la pieza se dobla con un ProductorPieza controlado (la
 * fábrica real de @soec/contenido está cubierta por sus propias suites); todo lo demás es real.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import { EstrategiaCreativaArtefactoService, type ContenidoArtefacto } from '@soec/estrategia-creativa';
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

const piezaListaBase: PiezaFuente = {
  version: 1, tituloInterno: 't', tesis: 'te', estructura: [], mensaje: 'm', cuerpo: 'Ayudamos a ordenar la operación.', llamadaAccion: 'cta',
  hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: 'x', estado: 'valida',
};
/** Productor que devuelve un paquete LISTO (dobla la fábrica; la real la cubre @soec/contenido). */
const productorListo: ProductorPieza = {
  async producir(_ctx, p): Promise<PayloadProducido> {
    return { briefRef: p.briefId, marcaRef: p.marcaId, canal: p.canalesDestino.join(','), planRef: p.planId, campaniaRef: p.campaniaId, actividadRef: p.actividadId, pieza: piezaListaBase, historialPiezas: [piezaListaBase], adaptaciones: [], activos: [], revisiones: [], hallazgos: [], resultado: 'listo', huella: 'h', costoProduccion: 1, estado: 'listo' };
  },
};

function montar() {
  const store = new InMemoryEventStore();
  const m5 = new MotorEstrategicoService(store);
  const artefacto = new EstrategiaCreativaArtefactoService(store);
  const pipeline = new PipelineCreativoService(store, m5, { factory: productorListo });
  const lectura = new LecturaCreativaService(store, m5);
  const motor = new MotorCreativoService(store, m5);
  return { store, m5, artefacto, pipeline, lectura, motor };
}

async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion, sostener: boolean) {
  await m5.registrar(c, id, clase, `afirmación ${id}`, attr, O);
  if (sostener) await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'dato', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}

const contenidoArt: ContenidoArtefacto = {
  programaId: 'prog', objetivoId: 'obj', segmentoId: 'icp', hipotesisId: 'hip', briefId: 'brief1',
  concepto: 'c', angulo: 'a', gancho: 'g', mensajesClave: ['m'], tono: 't', cta: 'cta', objeciones: [], respuestaObjeciones: [],
  pruebaSocialPermitida: false, afirmacionesPermitidas: ['plataforma clara'], restricciones: [], evidencias: ['E'], confianza: 'MEDIA', faltantes: [], politicaVersion: 'v1',
};

const brief = (over: Partial<ContenidoBrief> = {}): ContenidoBrief => ({
  organizationId: 'org-a', marcaId: 'marca', objetivoComercial: 'crecer', objetivoMarketing: 'reconocimiento', iniciativaId: 'ini', campaniaId: 'camp', planId: 'plan', actividadId: 'act',
  audiencia: 'pymes de servicios', segmento: 'pymes', etapaEmbudo: 'reconocimiento', canalDestino: 'blog', proposito: 'informar', mensajePrincipal: 'ordena tu operación',
  propuestaValor: 'plataforma clara', productoServicio: 'SOEC', problemaCliente: 'desorden', llamadaAccion: 'escríbenos', tono: 'cercano', idioma: 'es', territorio: 'prevención',
  restricciones: [], afirmacionesPermitidas: ['plataforma clara'], afirmacionesProhibidas: ['no prometer resultados'], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: '2026-09-01',
  ...over,
});

const entrada = (over: Partial<EntradaPipeline> = {}): EntradaPipeline => ({
  contextoId: 'ctx1',
  roles: [{ rol: 'ICP', afirmacionId: 'icp' }, { rol: 'PROPUESTA_VALOR', afirmacionId: 'pv' }, { rol: 'OBJETIVO', afirmacionId: 'obj' }],
  briefId: 'brief1', brief: brief(),
  territorioId: 'terr1', estrategiaCreativaId: 'estcr1',
  mensajes: [{ mensajeId: 'msg1', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }],
  validacion: { cuerpo: 'Ayudamos a las pymes a ordenar su operación.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false },
  paqueteId: 'paq1', formato: 'articulo', canal: 'blog',
  variante: { varianteId: 'v1', hipotesis: 'un gancho más directo mejora el CTR', elemento: 'gancho', diferencia: 'gancho directo', constantes: ['cta', 'cuerpo'] },
  calendario: { programaId: 'prog1', entradaId: 'ent1', fechaHora: FUTURO, zonaHoraria: 'UTC', objetivo: 'reconocimiento', segmento: 'pymes' },
  ...over,
});

/** Siembra M5 + territorio + artefacto para el camino feliz. */
async function sembrar(m5: MotorEstrategicoService, motor: MotorCreativoService, artefacto: EstrategiaCreativaArtefactoService, c: RequestContext) {
  await afirmar(m5, c, 'icp', 'ICP', true);
  await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR', true);
  await afirmar(m5, c, 'obj', 'OBJETIVO', true);
  await motor.registrarTerritorio(c, 'terr1', { tesis: 'prevención ordena', audienciaRef: 'icp', problemaCentral: 'desorden', tension: 'x', beneficio: 'orden', prueba: 'casos', riesgos: [], compatibilidadMarca: 'COMPATIBLE' }, attr, O);
  await motor.agregarEvidenciaTerritorio(c, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
  await artefacto.establecer(c, 'estcr1', contenidoArt, attr, O);
}

describe('pipeline · camino feliz (cadena completa gobernada)', () => {
  it('conecta contexto→brief→territorio→estrategia→mensajes→pieza→A/B→calendario y produce un PlanCreativo', async () => {
    const { m5, artefacto, pipeline, lectura, motor } = montar();
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    const r = await pipeline.componer(c, entrada(), attr, O);
    expect(esPropuesta(r)).toBe(true);
    if (!esPropuesta(r)) return;
    expect(r.valor.paqueteId).toBe('paq1');
    expect(r.valor.varianteId).toBe('v1');
    expect(r.valor.entradaCalendarioId).toBe('ent1');

    // Gobernanza aplicada y trazable:
    const pieza = await lectura.cargarPieza(c, 'paq1');
    expect(pieza.pieza?.formato).toBe('articulo');
    expect(pieza.pieza?.resultadoValidacion).toBe('VALIDO');
    expect(pieza.pieza?.trazabilidad?.[0]?.afirmacionId).toBe('pv');
    expect(pieza.pieza?.naturaleza).toBe('SIMULADO');
    const estrategia = await lectura.cargarEstrategia(c, 'estcr1');
    expect(estrategia.artefacto?.estadoGobernanza).toBe('VIGENTE');
    expect(estrategia.artefacto?.referenciasM5?.length).toBeGreaterThan(0);
    const brf = await lectura.cargarBrief(c, 'brief1');
    expect(brf.estado).toBe('listo');
    expect(brf.contenido?.contextoCreativoId).toBe('ctx1');
    // Calendario en BORRADOR: NO se programó automáticamente (eso exige aprobación humana).
    const cal = await lectura.cargarCalendario(c, 'prog1');
    expect(cal.entradas[0]?.estado).toBe('BORRADOR');
    const exp = await lectura.cargarExperimento(c, 'paq1');
    expect(exp.variantes[0]?.varianteId).toBe('v1');
  });

  it('idempotente: componer dos veces no duplica la pieza ni la variante', async () => {
    const { m5, artefacto, pipeline, lectura, motor } = montar();
    const c = ctx();
    await sembrar(m5, motor, artefacto, c);
    await pipeline.componer(c, entrada(), attr, O);
    const r2 = await pipeline.componer(c, entrada(), attr, O);
    expect(esPropuesta(r2)).toBe(true);
    expect((await lectura.cargarExperimento(c, 'paq1')).variantes).toHaveLength(1);
  });
});

describe('pipeline · gates de abstención (nunca produce artefactos inválidos)', () => {
  async function correr(seed: (m5: MotorEstrategicoService, motor: MotorCreativoService, art: EstrategiaCreativaArtefactoService, c: RequestContext) => Promise<void>, e: EntradaPipeline) {
    const { m5, artefacto, pipeline, lectura, motor } = montar();
    const c = ctx();
    await seed(m5, motor, artefacto, c);
    const r = await pipeline.componer(c, e, attr, O);
    return { r, lectura, c };
  }

  it('ICP no sostenido ⇒ abstención FALTA_AUDIENCIA, sin pieza', async () => {
    const { r, lectura, c } = await correr(async (m5, motor, art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', false); // NO_EVALUABLE
      await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', true);
      await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await motor.registrarTerritorio(cc, 'terr1', { tesis: 'x', audienciaRef: 'icp', problemaCentral: '', tension: '', beneficio: '', prueba: '', riesgos: [], compatibilidadMarca: 'C' }, attr, O);
      await art.establecer(cc, 'estcr1', contenidoArt, attr, O);
    }, entrada());
    expect(r.tipo).toBe('ABSTENCION');
    if (r.tipo === 'ABSTENCION') expect(r.abstencion.motivo).toBe('FALTA_AUDIENCIA');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });

  it('propuesta de valor no sostenida ⇒ FALTA_PROPUESTA_VALOR', async () => {
    const { r } = await correr(async (m5, motor, art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', true);
      await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', false); // NO_EVALUABLE
      await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await motor.registrarTerritorio(cc, 'terr1', { tesis: 'x', audienciaRef: 'icp', problemaCentral: '', tension: '', beneficio: '', prueba: '', riesgos: [], compatibilidadMarca: 'C' }, attr, O);
      await art.establecer(cc, 'estcr1', contenidoArt, attr, O);
    }, entrada());
    expect(r.tipo === 'ABSTENCION' && r.abstencion.motivo).toBe('FALTA_PROPUESTA_VALOR');
  });

  it('mensaje respaldado por afirmación RETIRADA ⇒ abstención, sin pieza', async () => {
    const { r, lectura, c } = await correr(async (m5, motor, art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', true);
      await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', true);
      await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await m5.retirar(cc, 'pv', 'dato caducado', attr, O); // el respaldo del mensaje se retira
      await motor.registrarTerritorio(cc, 'terr1', { tesis: 'x', audienciaRef: 'icp', problemaCentral: '', tension: '', beneficio: '', prueba: '', riesgos: [], compatibilidadMarca: 'C' }, attr, O);
      await motor.agregarEvidenciaTerritorio(cc, 'terr1', { afirmacionId: 'icp', version: 2 }, attr, O);
      await art.establecer(cc, 'estcr1', contenidoArt, attr, O);
    }, entrada());
    // pv retirada ⇒ FALTA_PROPUESTA_VALOR (se corta antes de validar mensajes), sin pieza.
    expect(r.tipo).toBe('ABSTENCION');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });

  it('texto con afirmación de riesgo no respaldada ⇒ abstención en la validación, sin pieza', async () => {
    const { r, lectura, c } = await correr(sembrar, entrada({ validacion: { cuerpo: 'El mejor software con 50% de descuento garantizado.', afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false } }));
    expect(r.tipo).toBe('ABSTENCION');
    if (r.tipo === 'ABSTENCION') expect(r.abstencion.motivo).toBe('SIN_AFIRMACION_PERMITIDA');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });

  it('mensaje cuyo tipo no autoriza la clase de la afirmación ⇒ abstención', async () => {
    const { r } = await correr(sembrar, entrada({
      mensajes: [{ mensajeId: 'msg1', tipo: 'PRUEBA', texto: 'probado', afirmacionRespaldoId: 'pv', evidenciaRef: null, audienciaId: 'icp', condicionesNoUso: [] }],
    }));
    // PROPUESTA_VALOR no autoriza un mensaje de PRUEBA.
    expect(r.tipo).toBe('ABSTENCION');
  });

  it('estrategia inexistente ⇒ abstención SIN_AFIRMACION_PERMITIDA', async () => {
    const { r } = await correr(async (m5, motor, _art, cc) => {
      await afirmar(m5, cc, 'icp', 'ICP', true);
      await afirmar(m5, cc, 'pv', 'PROPUESTA_VALOR', true);
      await afirmar(m5, cc, 'obj', 'OBJETIVO', true);
      await motor.registrarTerritorio(cc, 'terr1', { tesis: 'x', audienciaRef: 'icp', problemaCentral: '', tension: '', beneficio: '', prueba: '', riesgos: [], compatibilidadMarca: 'C' }, attr, O);
      await motor.agregarEvidenciaTerritorio(cc, 'terr1', { afirmacionId: 'pv', version: 2 }, attr, O);
      // NO se establece el artefacto.
    }, entrada());
    expect(r.tipo === 'ABSTENCION' && r.abstencion.motivo).toBe('SIN_AFIRMACION_PERMITIDA');
  });

  it('brief incompleto (sin audiencia) ⇒ abstención, sin pieza', async () => {
    const { r, lectura, c } = await correr(sembrar, entrada({ brief: brief({ audiencia: '' }) }));
    expect(r.tipo).toBe('ABSTENCION');
    expect((await lectura.cargarPieza(c, 'paq1')).existe).toBe(false);
  });
});

describe('pipeline · obsolescencia (vía LecturaCreativa)', () => {
  it('un cambio en M5 tras construir el contexto lo vuelve OBSOLETO', async () => {
    const { m5, motor, lectura } = montar();
    const c = ctx();
    await afirmar(m5, c, 'icp', 'ICP', true);
    await motor.construirContexto(c, 'ctxX', [{ rol: 'ICP', afirmacionId: 'icp' }], attr, O);
    expect(await lectura.vigenciaContexto(c, 'ctxX')).toBe('VIGENTE');
    await m5.agregarEvidencia(c, 'icp', { evidenciaId: 'icp-e2', enunciado: 'más', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    expect(await lectura.vigenciaContexto(c, 'ctxX')).toBe('OBSOLETO');
  });
});
