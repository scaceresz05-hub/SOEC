/**
 * @soec/estrategia-creativa · Tramo G/H · APROBACIÓN humana granular y su GATE en el ciclo. La aprobación
 * se liga a recurso+versión (una versión nueva no la hereda); aprobar un recurso NO aprueba a otro; y sin
 * aprobación de las piezas el ciclo se detiene en PENDIENTE_APROBACION sin autoaprobarse.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { AprobacionService, OrquestadorProgramaGenerativo, type ParametrosCampania } from '../src/index';

const attr: Attribution = { source: 'g', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a', actor = 'director'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId(actor), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'crecer', objetivoMarketing: 'leads', indicador: 'leads', lineaBase: 0, valorEsperado: 100,
  horizonteDias: 30, prioridad: 'alta', restricciones: [], presupuestoTotal: 100000, frecuenciaDias: 2,
  territorio: 'CL', idioma: 'es', moneda: 'CLP', canales: ['correo'],
};

async function sembrar(store: InMemoryEventStore, org = 'org-a') {
  const con = new ConocimientoComercialService(store);
  const hip = new HipotesisComercialService(store);
  const c = ctx(org);
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(c, 'empresa', 'propuestaValor', 'Odontología cercana y a plazos', DECL, attr, O);
  await con.registrarEntidad(c, 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
  await con.establecerCampo(c, 'p1', 'problemaQueResuelve', 'alinear dientes sin brackets', DECL, attr, O);
  await con.establecerCampo(c, 'p1', 'beneficios', 'sonrisa alineada discreta', DECL, attr, O);
  await con.registrarEntidad(c, 'icp1', 'CLIENTE_IDEAL', 'Adultos jóvenes profesionales', attr, O);
  await con.establecerCampo(c, 'icp1', 'dolores', 'vergüenza por dientes torcidos', DECL, attr, O);
  await hip.registrar(c, 'h1', 'Correo convierte para el ICP joven', 'canales', attr, O, { segmentoId: 'icp1' });
  await hip.agregarEvidencia(c, 'h1', 'e1', 'ICP responde a email', 'DATO_IMPORTADO', true, attr, O);
}

describe('@soec/estrategia-creativa · Tramo G · aprobación granular ligada a versión', () => {
  it('aprobar una versión no aprueba otra versión (modificar invalida la aprobación previa)', async () => {
    const store = new InMemoryEventStore();
    const svc = new AprobacionService(store);
    await svc.decidir(ctx(), { resourceType: 'PIEZA', resourceId: 'pz1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
    expect(await svc.estaAprobada(ctx(), 'PIEZA', 'pz1', 1)).toBe(true);
    expect(await svc.estaAprobada(ctx(), 'PIEZA', 'pz1', 2)).toBe(false); // la v2 no hereda
  });

  it('aprobar la campaña NO aprueba su pieza (recursos independientes)', async () => {
    const store = new InMemoryEventStore();
    const svc = new AprobacionService(store);
    await svc.decidir(ctx(), { resourceType: 'CAMPANIA', resourceId: 'c1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
    expect(await svc.estaAprobada(ctx(), 'CAMPANIA', 'c1', 1)).toBe(true);
    expect(await svc.estaAprobada(ctx(), 'PIEZA', 'c1', 1)).toBe(false); // otro tipo de recurso
  });

  it('registra al actor humano del contexto y una decisión posterior manda (RECHAZADA revoca)', async () => {
    const store = new InMemoryEventStore();
    const svc = new AprobacionService(store);
    await svc.decidir(ctx('org-a', 'ana'), { resourceType: 'PIEZA', resourceId: 'pz1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
    const st = await svc.decidir(ctx('org-a', 'ana'), { resourceType: 'PIEZA', resourceId: 'pz1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O);
    expect(st.ultima?.actorUserId).toBe('ana');
    expect(await svc.estaAprobada(ctx('org-a', 'ana'), 'PIEZA', 'pz1', 1)).toBe(false);
  });

  it('aislamiento multiempresa: la aprobación de org-a no aplica a org-b', async () => {
    const store = new InMemoryEventStore();
    const svc = new AprobacionService(store);
    await svc.decidir(ctx('org-a'), { resourceType: 'PIEZA', resourceId: 'pz1', resourceVersion: 1, decision: 'APROBADA' }, attr, O);
    expect(await svc.estaAprobada(ctx('org-b'), 'PIEZA', 'pz1', 1)).toBe(false);
  });
});

describe('@soec/estrategia-creativa · Tramo H · gate de aprobación en el ciclo', () => {
  it('preparar deja piezas y ejecutar SIN aprobación se detiene en PENDIENTE_APROBACION (no ejecuta)', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const orq = new OrquestadorProgramaGenerativo(store);
    const prep = await orq.prepararPrograma(ctx(), 'prog1', PARAMS, attr, O);
    expect(prep.tipo).toBe('PREPARADO');
    if (prep.tipo !== 'PREPARADO') return;
    expect(prep.piezas.length).toBeGreaterThan(0);
    const res = await orq.ejecutarSimulado(ctx(), 'prog1', attr, O);
    expect(res.tipo).toBe('PENDIENTE_APROBACION');
    // No ejecutó: el programa NO quedó EVALUADO.
    const { ProgramaService } = await import('@soec/programas');
    expect((await new ProgramaService(store).cargar(ctx(), 'prog1')).estado).not.toBe('EVALUADO');
  });

  it('con aprobación humana de TODOS los recursos (piezas+variantes+calendario), ejecutar corre hasta EVALUADO', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const orq = new OrquestadorProgramaGenerativo(store);
    const apr = new AprobacionService(store);
    const prep = await orq.prepararPrograma(ctx(), 'prog1', PARAMS, attr, O);
    if (prep.tipo !== 'PREPARADO') throw new Error('no preparó');
    // Aprobar SÓLO las piezas no alcanza: el gate exige también variantes y entradas de calendario.
    const recursos = await orq.recursosParaAprobar(ctx(), 'prog1');
    expect(recursos.some((r) => r.tipo === 'VARIANTE')).toBe(true);
    expect(recursos.some((r) => r.tipo === 'ENTRADA_CALENDARIO')).toBe(true);
    for (const p of recursos.filter((r) => r.tipo === 'PIEZA')) await apr.decidir(ctx(), { resourceType: 'PIEZA', resourceId: p.resourceId, resourceVersion: p.version, decision: 'APROBADA' }, attr, O);
    expect((await orq.ejecutarSimulado(ctx(), 'prog1', attr, O)).tipo).toBe('PENDIENTE_APROBACION'); // faltan variantes/calendario
    for (const r of recursos) await apr.decidir(ctx(), { resourceType: r.tipo, resourceId: r.resourceId, resourceVersion: r.version, decision: 'APROBADA' }, attr, O);
    const res = await orq.ejecutarSimulado(ctx(), 'prog1', attr, O);
    expect(res.tipo).toBe('PROPUESTA');
    const { ProgramaService } = await import('@soec/programas');
    expect((await new ProgramaService(store).cargar(ctx(), 'prog1')).estado).toBe('EVALUADO');
  });

  it('B-5: la aprobación se liga a la versión REAL del artefacto; una versión nueva no hereda', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const orq = new OrquestadorProgramaGenerativo(store);
    const apr = new AprobacionService(store);
    await orq.prepararPrograma(ctx(), 'prog1', PARAMS, attr, O);
    const recursos = await orq.recursosParaAprobar(ctx(), 'prog1');
    const pieza = recursos.find((r) => r.tipo === 'PIEZA')!;
    expect(pieza.version).toBe(1);
    // Aprobar en v1 y verificar; luego una v2 (simulada) del mismo recurso no está aprobada.
    await apr.decidir(ctx(), { resourceType: 'PIEZA', resourceId: pieza.resourceId, resourceVersion: 1, decision: 'APROBADA' }, attr, O);
    expect(await apr.estaAprobada(ctx(), 'PIEZA', pieza.resourceId, 1)).toBe(true);
    expect(await apr.estaAprobada(ctx(), 'PIEZA', pieza.resourceId, 2)).toBe(false); // v2 no hereda
  });
});
