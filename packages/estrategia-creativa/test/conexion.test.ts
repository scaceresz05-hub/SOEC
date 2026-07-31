/**
 * @soec/estrategia-creativa · conexión completa. Deriva segmentos (desde ICP), hipótesis de programa
 * (desde hipótesis comerciales) y objetivo (desde conocimiento + parámetros) para alimentar el
 * pipeline existente en vez de fixtures. Evaluable: ABSTIENE si el conocimiento no alcanza.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { EstrategiaCreativaService, type ParametrosCampania } from '../src/index';

const attr: Attribution = { source: 'ec', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'crecer ventas',
  objetivoMarketing: 'generar leads',
  indicador: 'leads',
  lineaBase: 0,
  valorEsperado: 100,
  horizonteDias: 30,
  prioridad: 'alta',
  restricciones: [],
  presupuestoTotal: 100000,
  frecuenciaDias: 2,
  territorio: 'CL',
  idioma: 'es',
  moneda: 'CLP',
  canales: ['instagram'],
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
  await con.establecerCampo(c, 'icp1', 'motivaciones', 'verse mejor en el trabajo', DECL, attr, O);
  await con.registrarEntidad(c, 'mkt', 'MERCADO', 'Odontología estética urbana', attr, O);
  // Una hipótesis comercial con evidencia (para derivar la hipótesis de programa).
  await hip.registrar(c, 'h1', 'Instagram convierte mejor para el ICP joven', 'canales', attr, O);
  await hip.agregarEvidencia(c, 'h1', 'e1', 'ICP joven activo en IG', 'DATO_IMPORTADO', true, attr, O);
}

describe('@soec/estrategia-creativa · paquete de conexión', () => {
  it('deriva segmentos (ICP), hipótesis de programa y objetivo desde el cerebro comercial', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const hip = new HipotesisComercialService(store);
    await sembrar(con, hip);
    const s = new EstrategiaCreativaService(store, con, hip);
    const res = await s.derivarConexion(ctx(), PARAMS);
    expect(res.tipo).toBe('PROPUESTA');
    if (res.tipo === 'PROPUESTA') {
      const p = res.paquete;
      expect(p.segmentos).toHaveLength(1);
      expect(p.segmentos[0]?.nombre).toBe('Adultos jóvenes profesionales');
      expect(p.segmentos[0]?.problemas.length).toBeGreaterThan(0);
      expect(p.hipotesis).toHaveLength(1);
      expect(p.hipotesis[0]?.segmentoId).toBe('icp1');
      expect(p.hipotesis[0]?.evidencia.length).toBeGreaterThan(0);
      expect(p.objetivo.empresa).toBe('SmileFlow');
      expect(p.objetivo.mercado).toBe('Odontología estética urbana');
      expect(p.objetivo.presupuestoTotal).toBe(100000);
      expect(p.objetivo.canales).toContain('instagram');
      expect(p.estrategia.concepto).toBeTruthy();
    }
  });

  it('sin conocimiento suficiente → ABSTENCION (no arma un paquete inventado)', async () => {
    const store = new InMemoryEventStore();
    const s = new EstrategiaCreativaService(store);
    const res = await s.derivarConexion(ctx('org-vacia'), PARAMS);
    expect(res.tipo).toBe('ABSTENCION');
    if (res.tipo === 'ABSTENCION') expect(res.faltantes.length).toBeGreaterThan(0);
  });
});
