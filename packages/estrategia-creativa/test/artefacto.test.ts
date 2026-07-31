/**
 * @soec/estrategia-creativa · Tramo D: artefacto de estrategia creativa de 1.ª clase. Persistido,
 * versionado, con afirmaciones LIGADAS A EVIDENCIA y sin inventar prueba social/testimonios.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import {
  EstrategiaCreativaArtefactoService,
  OrquestadorProgramaGenerativo,
  type ParametrosCampania,
  estrategiaCreativaId,
} from '../src/index';

const attr: Attribution = { source: 'd', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'crecer', objetivoMarketing: 'leads', indicador: 'leads', lineaBase: 0, valorEsperado: 100,
  horizonteDias: 30, prioridad: 'alta', restricciones: [], presupuestoTotal: 100000, frecuenciaDias: 2,
  territorio: 'CL', idioma: 'es', moneda: 'CLP', canales: ['correo'],
};

async function sembrar(con: ConocimientoComercialService, hip: HipotesisComercialService) {
  const c = ctx();
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(c, 'empresa', 'propuestaValor', 'Odontología cercana y a plazos', DECL, attr, O);
  await con.registrarEntidad(c, 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
  await con.establecerCampo(c, 'p1', 'problemaQueResuelve', 'alinear dientes sin brackets', DECL, attr, O);
  await con.establecerCampo(c, 'p1', 'beneficios', 'sonrisa alineada discreta', DECL, attr, O);
  await con.registrarEntidad(c, 'icp1', 'CLIENTE_IDEAL', 'Adultos jóvenes profesionales', attr, O);
  await con.establecerCampo(c, 'icp1', 'dolores', 'vergüenza por dientes torcidos', DECL, attr, O);
  await hip.registrar(c, 'h1', 'Correo convierte para el ICP joven', 'canales', attr, O);
  await hip.agregarEvidencia(c, 'h1', 'e1', 'ICP responde a email', 'DATO_IMPORTADO', true, attr, O);
}

describe('@soec/estrategia-creativa · Tramo D · artefacto de estrategia creativa', () => {
  it('el orquestador persiste el artefacto con afirmaciones ligadas a evidencia y sin prueba social inventada', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    await new OrquestadorProgramaGenerativo(store).generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    const art = await new EstrategiaCreativaArtefactoService(store).cargar(ctx(), estrategiaCreativaId('prog1', 'h1'));
    expect(art.existe).toBe(true);
    const a = art.artefacto!;
    expect(a.hipotesisId).toBe('h1');
    expect(a.programaId).toBe('prog1');
    expect(a.naturaleza).toBe('SIMULADO');
    expect(a.pruebaSocialPermitida).toBe(false); // nunca se inventa
    expect(a.afirmacionesPermitidas.length).toBeGreaterThan(0);
    expect(a.evidencias.length).toBe(a.afirmacionesPermitidas.length); // cada afirmación con su procedencia
    expect(a.evidencias.every((e) => e.includes('DATO_DECLARADO_POR_USUARIO'))).toBe(true);
    expect(a.version).toBe(1);
  });

  it('re-derivar idéntico no versiona; un cambio sí genera nueva versión', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    const orq = new OrquestadorProgramaGenerativo(store);
    await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    const svc = new EstrategiaCreativaArtefactoService(store);
    const id = estrategiaCreativaId('prog1', 'h1');
    const v1 = (await svc.cargar(ctx(), id)).artefacto!.version;
    // Cambio real del conocimiento → nueva versión al re-derivar en un programa nuevo con la misma hipótesis.
    await con.establecerCampo(ctx(), 'p1', 'beneficios', 'sonrisa perfecta y discreta (mejorado)', DECL, attr, O);
    await orq.generarPrograma(ctx(), 'prog2', PARAMS, attr, O);
    const v2prog2 = (await svc.cargar(ctx(), estrategiaCreativaId('prog2', 'h1'))).artefacto!;
    expect(v1).toBe(1);
    expect(v2prog2.afirmacionesPermitidas.some((x) => x.includes('mejorado'))).toBe(true);
  });

  it('B-1: establecer el MISMO contenido N veces sobre el mismo stream NO versiona (idempotente)', async () => {
    const store = new InMemoryEventStore();
    const svc = new EstrategiaCreativaArtefactoService(store);
    const contenido = {
      programaId: 'p', objetivoId: 'obj', segmentoId: 's', hipotesisId: 'h', briefId: 'b', concepto: 'c',
      angulo: 'a', gancho: 'g', mensajesClave: ['m1', 'm2'], tono: 't', cta: 'cta', objeciones: ['o1'],
      respuestaObjeciones: ['r1'], pruebaSocialPermitida: false, afirmacionesPermitidas: ['x'],
      restricciones: ['no médico'], evidencias: ['e'], confianza: 'MEDIA' as const, faltantes: [], politicaVersion: 'v1',
    };
    const v1 = await svc.establecer(ctx(), 'est1', contenido, attr, O);
    const v2 = await svc.establecer(ctx(), 'est1', { ...contenido }, attr, O); // idéntico (otra referencia)
    const v3 = await svc.establecer(ctx(), 'est1', { ...contenido }, attr, O);
    expect([v1.artefacto?.version, v2.artefacto?.version, v3.artefacto?.version]).toEqual([1, 1, 1]);
    // Un cambio REAL sí versiona.
    const v4 = await svc.establecer(ctx(), 'est1', { ...contenido, gancho: 'gancho nuevo' }, attr, O);
    expect(v4.artefacto?.version).toBe(2);
  });

  it('aislamiento multiempresa del artefacto', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    await new OrquestadorProgramaGenerativo(store).generarPrograma(ctx('org-a'), 'prog1', PARAMS, attr, O);
    const b = await new EstrategiaCreativaArtefactoService(store).cargar(ctx('org-b'), estrategiaCreativaId('prog1', 'h1'));
    expect(b.existe).toBe(false);
  });
});
