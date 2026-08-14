/**
 * SOEC · FUNDAMENTOS POR MODELO DE NEGOCIO (A0.5 · Blocker 1).
 *
 * Los fundamentos REQUERIDOS dependen del modelo/capacidades del negocio, no de su organizationId.
 * Un SaaS no necesita catálogo ni ventas de tienda; un e-commerce sí. Un modelo desconocido falla
 * cerrado. Sin `if org === ...`.
 */
import { describe, expect, it } from 'vitest';
import {
  buscarFuentes,
  buscarPerfilComercial,
  evaluarFundamentos,
  getBusiness,
  ORG_SMILEFLOW,
} from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';
import type { NegocioRegistrado } from '../src/plataforma/tipos';

const SAAS = getBusiness(ORG_SMILEFLOW); // modeloDeNegocio = SAAS_FUNNEL
const ECOM = getBusiness(ORG_CYP); // modeloDeNegocio = ECOMMERCE_DISTRIBUCION

function codigos(neg: NegocioRegistrado, fuentes = [], perfilComercial: null = null, tienePolitica = false): string[] {
  return evaluarFundamentos(neg, fuentes, perfilComercial, tienePolitica, null).motivos.map((m) => m.codigo);
}

describe('Fundamentos por modelo · SaaS no exige requisitos de e-commerce', () => {
  it('SAAS_DOES_NOT_REQUIRE_ECOMMERCE_CATALOG', () => {
    const r = evaluarFundamentos(SAAS, buscarFuentes(ORG_SMILEFLOW), buscarPerfilComercial(ORG_SMILEFLOW), true, null);
    expect(r.motivos.map((m) => m.codigo)).not.toContain('CATALOG_NOT_OBSERVED');
  });

  it('SAAS_DOES_NOT_REQUIRE_WOOCOMMERCE_SALES', () => {
    const r = evaluarFundamentos(SAAS, buscarFuentes(ORG_SMILEFLOW), buscarPerfilComercial(ORG_SMILEFLOW), true, null);
    expect(r.motivos.map((m) => m.codigo)).not.toContain('SALES_NOT_CONNECTED');
  });

  it('SmileFlow real (adquisición Ads + señal growth + perfil) ⇒ EVALUABLE (resultado natural)', () => {
    const r = evaluarFundamentos(SAAS, buscarFuentes(ORG_SMILEFLOW), buscarPerfilComercial(ORG_SMILEFLOW), true, null);
    expect(r.veredicto).toBe('EVALUABLE');
    // La economía sigue informándose (gatea inversión), pero no bloquea el fundamento.
    expect(r.puedeRecomendarInversionPublicitaria).toBe(false);
  });
});

describe('Fundamentos por modelo · e-commerce SÍ exige catálogo y ventas', () => {
  it('ECOMMERCE_CAN_REQUIRE_CATALOG', () => {
    const c = codigos({ ...ECOM }); // e-commerce sin ninguna fuente
    expect(c).toContain('CATALOG_NOT_OBSERVED');
  });

  it('ECOMMERCE_CAN_REQUIRE_SALES', () => {
    const c = codigos({ ...ECOM });
    expect(c).toContain('SALES_NOT_CONNECTED');
  });

  it('C Y P real (e-commerce) sigue en FOUNDATION_REQUIRED, sin cambios de política', () => {
    const r = evaluarFundamentos(ECOM, buscarFuentes(ORG_CYP), buscarPerfilComercial(ORG_CYP), false, null);
    expect(r.veredicto).toBe('FOUNDATION_REQUIRED');
    expect(r.motivos.map((m) => m.codigo)).toContain('ECONOMICS_UNKNOWN');
  });
});

describe('Fundamentos por modelo · tercer modelo y desconocido', () => {
  it('THIRD_BUSINESS_MODEL_CAN_DEFINE_FOUNDATION_POLICY: SERVICIOS define su propia política (no exige catálogo)', () => {
    const servicios: NegocioRegistrado = { ...ECOM, modeloDeNegocio: 'SERVICIOS' };
    const c = codigos(servicios);
    expect(c).not.toContain('CATALOG_NOT_OBSERVED');
    expect(c).not.toContain('SALES_NOT_CONNECTED');
    // Sí exige una fuente de adquisición.
    expect(c).toContain('ACQUISITION_NOT_CONNECTED');
  });

  it('UNKNOWN_MODEL_FAILS_CLOSED: modelo no reconocido ⇒ FOUNDATION_REQUIRED', () => {
    const desconocido = { ...ECOM, modeloDeNegocio: 'CRYPTO_CASINO' } as unknown as NegocioRegistrado;
    const r = evaluarFundamentos(desconocido, [], null, true, null);
    expect(r.veredicto).toBe('FOUNDATION_REQUIRED');
    expect(r.motivos.map((m) => m.codigo)).toContain('UNKNOWN_BUSINESS_MODEL');
  });
});
