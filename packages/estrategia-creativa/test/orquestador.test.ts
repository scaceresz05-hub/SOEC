/**
 * @soec/estrategia-creativa · orquestador generativo end-to-end (Tramos A/B/C/H). Corre el flujo real
 * (conocimiento → programa poblado → campañas derivadas → contenido generado por ProveedorGenerativo →
 * ciclo existente: aprobación → ejecución simulada → medición → aprendizaje) SIN fixtures. Idempotente.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { ProgramaService } from '@soec/programas';
import { CalendarioEditorialService, OrquestadorProgramaGenerativo, VariantesABService, type ParametrosCampania } from '../src/index';

const attr: Attribution = { source: 'orq', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'crecer ventas', objetivoMarketing: 'generar leads', indicador: 'leads', lineaBase: 0, valorEsperado: 100,
  horizonteDias: 30, prioridad: 'alta', restricciones: [], presupuestoTotal: 100000, frecuenciaDias: 2,
  territorio: 'CL', idioma: 'es', moneda: 'CLP', canales: ['correo'],
};

async function sembrar(con: ConocimientoComercialService, hip: HipotesisComercialService, org = 'org-a') {
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

describe('@soec/estrategia-creativa · orquestador generativo end-to-end', () => {
  it('corre el flujo completo sin fixtures y deja el programa EVALUADO (contenido generado)', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    const orq = new OrquestadorProgramaGenerativo(store);
    const res = await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    expect(res.tipo).toBe('PROPUESTA');
    if (res.tipo === 'PROPUESTA') expect(res.vista).toBeTruthy();
    const prog = await new ProgramaService(store).cargar(ctx(), 'prog1');
    expect(prog.estado).toBe('EVALUADO');
    expect(prog.campanias.length).toBeGreaterThan(0);
    expect(prog.campanias[0]?.contenidoIds.length).toBeGreaterThan(0);
  });

  it('integra variantes A/B (una variable) y calendario editorial al flujo', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    await new OrquestadorProgramaGenerativo(store).generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    const prog = await new ProgramaService(store).cargar(ctx(), 'prog1');
    const piezaId = prog.campanias[0]!.contenidoIds[0]!;
    const ab = await new VariantesABService(store).cargar(ctx(), piezaId);
    expect(ab.variantes).toHaveLength(2);
    expect(ab.variantes.every((v) => v.elementoModificado === 'gancho')).toBe(true); // una sola variable
    const cal = await new CalendarioEditorialService(store).cargar(ctx(), 'prog1');
    expect(cal.entradas.length).toBeGreaterThan(0);
    expect(cal.entradas[0]?.estado).toBe('BORRADOR'); // no programado sin aprobación
  });

  it('es idempotente: re-ejecutar no duplica campañas ni re-corre el ciclo', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    const orq = new OrquestadorProgramaGenerativo(store);
    await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    const prog = await new ProgramaService(store).cargar(ctx(), 'prog1');
    expect(prog.campanias).toHaveLength(1); // no duplicó
  });

  it('sin conocimiento evaluable → ABSTENCION sin ejecutar nada', async () => {
    const store = new InMemoryEventStore();
    const orq = new OrquestadorProgramaGenerativo(store);
    const res = await orq.generarPrograma(ctx('org-vacia'), 'prog1', PARAMS, attr, O);
    expect(res.tipo).toBe('ABSTENCION');
    expect((await new ProgramaService(store).cargar(ctx('org-vacia'), 'prog1')).existe).toBe(false);
  });

  it('aislamiento multiempresa: org-b no ejecuta el conocimiento de org-a', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip, 'org-a');
    const orq = new OrquestadorProgramaGenerativo(store);
    expect((await orq.generarPrograma(ctx('org-b'), 'prog1', PARAMS, attr, O)).tipo).toBe('ABSTENCION');
  });
});
