/**
 * @soec/motor-creativo · tests adversariales (M6). Integración real M5→M6: el motor creativo consume un
 * `MotorEstrategicoService` real como `LecturaConocimiento`. Intenta romper: abstención con conocimiento
 * incompleto, obsolescencia de versiones, referencias rotas, multi-tenant, replay, concurrencia,
 * idempotencia y las consultas.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, ConcurrencyError, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService, type ClaseAfirmacion } from '@soec/motor-estrategico';
import {
  MotorCreativoService,
  contextoEvaluable,
  detectarObsolescencia,
  esPropuesta,
  reconstruirTerritorio,
  type ContenidoTerritorio,
} from '../src/index';

const attr: Attribution = { source: 'm6-test', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

/** Monta M5 + M6 sobre un mismo store. */
function montar() {
  const store = new InMemoryEventStore();
  const m5 = new MotorEstrategicoService(store);
  const m6 = new MotorCreativoService(store, m5);
  return { store, m5, m6 };
}

/** Registra en M5 una afirmación y (opcionalmente) la sostiene con evidencia a favor (⇒ VERDADERO). */
async function afirmar(m5: MotorEstrategicoService, c: RequestContext, id: string, clase: ClaseAfirmacion, sostener: boolean) {
  await m5.registrar(c, id, clase, `afirmación ${id}`, attr, O);
  if (sostener) await m5.agregarEvidencia(c, id, { evidenciaId: `${id}-e`, enunciado: 'dato', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
}

const contenidoTerr = (over: Partial<ContenidoTerritorio> = {}): ContenidoTerritorio => ({
  tesis: 'la prevención ordena la operación',
  audienciaRef: 'icp',
  problemaCentral: 'desorden operacional',
  tension: 'urgente vs importante',
  beneficio: 'tranquilidad',
  prueba: 'casos',
  riesgos: ['tono paternalista'],
  compatibilidadMarca: 'COMPATIBLE',
  ...over,
});

describe('M6 · contexto creativo (puente desde M5)', () => {
  it('construye referencias versionadas y declara FALTANTES cuando M5 no sostiene el rol', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await afirmar(m5, c, 'emp', 'EMPRESA', true);
    await afirmar(m5, c, 'obj', 'OBJETIVO', false); // sin evidencia ⇒ NO_EVALUABLE
    const st = await m6.construirContexto(c, 'ctx-1', [
      { rol: 'EMPRESA', afirmacionId: 'emp' },
      { rol: 'OBJETIVO', afirmacionId: 'obj' },
      { rol: 'ICP', afirmacionId: 'inexistente' },
    ], attr, O);
    expect(st.referencias.map((r) => r.rol)).toEqual(['EMPRESA', 'OBJETIVO']);
    expect(st.referencias.find((r) => r.rol === 'EMPRESA')?.estado).toBe('VERDADERO');
    // OBJETIVO no evaluable + ICP inexistente ⇒ 2 faltantes; contexto NO evaluable.
    expect(st.faltantes).toHaveLength(2);
    expect(contextoEvaluable(st)).toBe(false);
  });

  it('detecta OBSOLESCENCIA cuando una afirmación referenciada cambia de versión en M5', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await afirmar(m5, c, 'emp', 'EMPRESA', true);
    await m6.construirContexto(c, 'ctx-1', [{ rol: 'EMPRESA', afirmacionId: 'emp' }], attr, O);
    // M5 cambia: nueva evidencia ⇒ sube la versión del agregado.
    await m5.agregarEvidencia(c, 'emp', { evidenciaId: 'emp-e2', enunciado: 'más', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    const desajustes = await m6.verificarVigencia(c, 'ctx-1', attr, O);
    expect(desajustes).toHaveLength(1);
    const st = await m6.cargarContexto(c, 'ctx-1');
    expect(st.obsoleto).toBe(true);
  });

  it('detectarObsolescencia (puro): referencia desaparecida ⇒ desajuste con versionActual null', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await afirmar(m5, c, 'emp', 'EMPRESA', true);
    const st = await m6.construirContexto(c, 'ctx-1', [{ rol: 'EMPRESA', afirmacionId: 'emp' }], attr, O);
    const d = detectarObsolescencia(st, {}); // ninguna versión actual conocida
    expect(d).toHaveLength(1);
    expect(d[0]!.versionActual).toBeNull();
  });
});

describe('M6 · territorio (evaluado derivando de M5)', () => {
  it('abstiene si falta audiencia declarada', async () => {
    const { m6 } = montar();
    const c = ctx();
    await m6.registrarTerritorio(c, 't1', contenidoTerr({ audienciaRef: null }), attr, O);
    const r = await m6.evaluarTerritorio(c, 't1');
    expect(r.tipo).toBe('ABSTENCION');
    if (r.tipo === 'ABSTENCION') expect(r.abstencion.motivo).toBe('FALTA_AUDIENCIA');
  });

  it('abstiene si la audiencia no está sostenida en M5', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await afirmar(m5, c, 'icp', 'ICP', false); // NO_EVALUABLE
    await m6.registrarTerritorio(c, 't1', contenidoTerr(), attr, O);
    const r = await m6.evaluarTerritorio(c, 't1');
    expect(r.tipo).toBe('ABSTENCION');
  });

  it('propone cuando audiencia sostenida y ≥1 evidencia sostenida en M5', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await afirmar(m5, c, 'icp', 'ICP', true);
    await afirmar(m5, c, 'pv', 'PROPUESTA_VALOR', true);
    await m6.registrarTerritorio(c, 't1', contenidoTerr(), attr, O);
    await m6.agregarEvidenciaTerritorio(c, 't1', { afirmacionId: 'pv', version: 2 }, attr, O);
    const r = await m6.evaluarTerritorio(c, 't1');
    expect(esPropuesta(r)).toBe(true);
    if (esPropuesta(r)) expect(r.valor.sostenidas).toBe(1);
  });
});

describe('M6 · multi-tenant, replay, concurrencia, idempotencia, consultas', () => {
  it('aislamiento: un territorio de org-a no es visible en org-b', async () => {
    const { m6 } = montar();
    await m6.registrarTerritorio(ctx('org-a'), 't1', contenidoTerr(), attr, O);
    expect((await m6.cargarTerritorio(ctx('org-b'), 't1')).existe).toBe(false);
    expect(await m6.listarTerritorios(ctx('org-b'))).toEqual([]);
  });

  it('replay determinista del territorio', async () => {
    const { store, m6 } = montar();
    const c = ctx();
    await m6.registrarTerritorio(c, 't1', contenidoTerr(), attr, O);
    await m6.agregarEvidenciaTerritorio(c, 't1', { afirmacionId: 'x', version: 1 }, attr, O);
    const { territorioStreamId } = await import('../src/index');
    const eventos = await store.readStream(c, territorioStreamId('org-a', 't1'));
    expect(reconstruirTerritorio('org-a', 't1', eventos)).toEqual(reconstruirTerritorio('org-a', 't1', eventos));
  });

  it('evidencia de territorio idempotente por afirmacionId', async () => {
    const { m6 } = montar();
    const c = ctx();
    await m6.registrarTerritorio(c, 't1', contenidoTerr(), attr, O);
    await m6.agregarEvidenciaTerritorio(c, 't1', { afirmacionId: 'x', version: 1 }, attr, O);
    await m6.agregarEvidenciaTerritorio(c, 't1', { afirmacionId: 'x', version: 9 }, attr, O); // mismo id ⇒ ignorado
    expect((await m6.cargarTerritorio(c, 't1')).evidencias).toHaveLength(1);
  });

  it('dos escrituras concurrentes sobre el mismo territorio ⇒ una ConcurrencyError', async () => {
    const { m6 } = montar();
    const c = ctx();
    await m6.registrarTerritorio(c, 't1', contenidoTerr(), attr, O);
    const res = await Promise.allSettled([
      m6.agregarEvidenciaTerritorio(c, 't1', { afirmacionId: 'a', version: 1 }, attr, O),
      m6.agregarEvidenciaTerritorio(c, 't1', { afirmacionId: 'b', version: 1 }, attr, O),
    ]);
    const rechazos = res.filter((r) => r.status === 'rejected');
    expect(rechazos).toHaveLength(1);
    expect((rechazos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
  });

  it('listarTerritorios devuelve el índice de la organización', async () => {
    const { m6 } = montar();
    const c = ctx();
    await m6.registrarTerritorio(c, 't1', contenidoTerr(), attr, O);
    await m6.registrarTerritorio(c, 't2', contenidoTerr({ tesis: 'educación primero' }), attr, O);
    expect((await m6.listarTerritorios(c)).map((t) => t.territorioId).sort()).toEqual(['t1', 't2']);
  });
});
