/**
 * @soec/estrategia-creativa · A-3 · Validación SEMÁNTICA del contenido comercial. Ninguna pieza es
 * publicable-simulada si el cuerpo afirma precios/garantías/superlativos/testimonios/certificaciones sin
 * respaldo. Un proveedor con salida maliciosa NO pasa: el orquestador abstiene y registra el veredicto.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import type { ProveedorGenerativo, RespuestaGenerativa, SolicitudGenerativa } from '@soec/contenido';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { ProgramaService } from '@soec/programas';
import { OrquestadorProgramaGenerativo, ValidacionContenidoService, validarContenidoComercial, type ParametrosCampania } from '../src/index';

const attr: Attribution = { source: 'a3', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-08-01T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'crecer', objetivoMarketing: 'leads', indicador: 'leads', lineaBase: 0, valorEsperado: 100,
  horizonteDias: 30, prioridad: 'alta', restricciones: [], presupuestoTotal: 100000, frecuenciaDias: 2,
  territorio: 'CL', idioma: 'es', moneda: 'CLP', canales: ['correo'],
};

describe('@soec/estrategia-creativa · A-3 · validador de contenido (unidad)', () => {
  const base = { afirmacionesPermitidas: ['sonrisa alineada discreta'], restricciones: [] as string[], pruebaSocialPermitida: false };
  it('acepta un cuerpo sin afirmaciones de riesgo', () => {
    expect(validarContenidoComercial({ cuerpo: 'Ordena tu agenda dental con una plataforma cercana. Solicita una demostración.', ...base }).resultado).toBe('VALIDO');
  });
  it('rechaza precio no respaldado', () => {
    expect(validarContenidoComercial({ cuerpo: 'Tu plan por solo $9.990 al mes.', ...base }).resultado).toBe('INVALIDO');
  });
  it('rechaza garantía de resultados', () => {
    expect(validarContenidoComercial({ cuerpo: 'Resultados garantizados o te devolvemos el dinero.', ...base }).resultado).toBe('INVALIDO');
  });
  it('rechaza superlativo absoluto', () => {
    expect(validarContenidoComercial({ cuerpo: 'Somos la mejor clínica del país.', ...base }).resultado).toBe('INVALIDO');
  });
  it('rechaza testimonio inventado cuando la prueba social no está permitida', () => {
    expect(validarContenidoComercial({ cuerpo: '"Me cambió la vida" — María G.', ...base }).resultado).toBe('INVALIDO');
  });
  it('rechaza certificación no respaldada', () => {
    expect(validarContenidoComercial({ cuerpo: 'Producto certificado por la autoridad sanitaria.', ...base }).resultado).toBe('INVALIDO');
  });
  it('marca REQUIERE_REVISION un cuerpo vacío', () => {
    expect(validarContenidoComercial({ cuerpo: '   ', ...base }).resultado).toBe('REQUIERE_REVISION');
  });
});

/** Proveedor MALICIOSO: su salida (estructuralmente válida) contiene afirmaciones no respaldadas. */
class ProveedorMalicioso implements ProveedorGenerativo {
  readonly nombre = 'malicioso';
  readonly version = '1';
  async generar(_ctx: RequestContext, _s: SolicitudGenerativa): Promise<RespuestaGenerativa> {
    return {
      estado: 'valida',
      salida: { campos: { cuerpo: 'La MEJOR clínica de Chile. Resultados garantizados por solo $9.990. "Increíble" — Ana P.' }, listas: {} },
      proveedorLogico: 'malicioso', modeloLogico: 'm1', generadoEn: O, uso: { unidades: 1, costoEstimado: 0 }, advertencias: [], promptRef: 'x',
    };
  }
}

async function sembrar(store: InMemoryEventStore) {
  const con = new ConocimientoComercialService(store);
  const hip = new HipotesisComercialService(store);
  const c = ctx();
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(c, 'empresa', 'propuestaValor', 'Odontología cercana', DECL, attr, O);
  await con.registrarEntidad(c, 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
  await con.establecerCampo(c, 'p1', 'problemaQueResuelve', 'alinear dientes', DECL, attr, O);
  await con.establecerCampo(c, 'p1', 'beneficios', 'sonrisa alineada discreta', DECL, attr, O);
  await con.registrarEntidad(c, 'icp1', 'CLIENTE_IDEAL', 'Adultos jóvenes', attr, O);
  await con.establecerCampo(c, 'icp1', 'dolores', 'vergüenza por dientes torcidos', DECL, attr, O);
  await hip.registrar(c, 'h1', 'Correo convierte', 'canales', attr, O, { segmentoId: 'icp1' });
  await hip.agregarEvidencia(c, 'h1', 'e1', 'ICP responde a email', 'DATO_IMPORTADO', true, attr, O);
}

describe('@soec/estrategia-creativa · A-3 · el orquestador rechaza contenido malicioso', () => {
  it('con un proveedor que afirma precio/garantía/testimonio, ABSTIENE y no crea pieza; registra el veredicto', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const orq = new OrquestadorProgramaGenerativo(store, { proveedor: new ProveedorMalicioso() });
    const res = await orq.generarPrograma(ctx(), 'progM', PARAMS, attr, O);
    expect(res.tipo).toBe('ABSTENCION');
    // No se crearon piezas publicables.
    const prog = await new ProgramaService(store).cargar(ctx(), 'progM');
    expect(prog.campanias.flatMap((c) => c.contenidoIds)).toHaveLength(0);
    expect(prog.estado).not.toBe('EVALUADO');
    // Se registró el veredicto INVALIDO (auditable).
    const reg = await new ValidacionContenidoService(store).cargar(ctx(), 'estcr-progM-h1:correo');
    expect(reg.ultimo?.resultado).toBe('INVALIDO');
    expect(reg.ultimo?.afirmacionesNoRespaldadas.length).toBeGreaterThan(0);
    expect(reg.ultimo?.naturaleza).toBe('SIMULADO');
  });
});
