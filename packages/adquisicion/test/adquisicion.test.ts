/**
 * Tests adversariales permanentes del motor de adquisición (FASE 52).
 *
 * Certifican por comportamiento las garantías duras: aislamiento por tenant, fail-closed sin
 * credencial, «no conectado» ╪ «cero», bloqueo de autopublicación sin BrandPolicy, PAID sin política
 * denegado, aislamiento de datos de test, atribución DESCONOCIDA que permanece desconocida, y que
 * AUTONOMOUS_REAL apagado bloquea toda mutación Meta. Sin red, sin reloj, sin efectos externos.
 */
import { describe, expect, it } from 'vitest';
import {
  ATRIBUCION_DESCONOCIDA,
  assertCuentaDeTenant,
  CuentaCruzadaError,
  cuentaNoConectada,
  cuentaNoConfigurada,
  canalTieneLectura,
  volumenObservable,
  clasificarNivelAtribucion,
  conNivelDerivado,
  sostieneCanal,
  UTM_VACIO,
  normalizarLead,
  LeadInvalidoError,
  cuentaComoComercial,
  identidadLead,
  evaluarAutopublicacion,
  claimBloqueado,
  paidAutonomoPermitido,
  planificarAdquisicion,
  sinEfectoExterno,
  esResultadoComercialFuerte,
  leadNoEsCliente,
  rangoEmbudo,
  clasificacionInicial,
  MetaWriteBloqueado,
  MetaWriteBloqueadoError,
  MetaReadNoConectado,
  cpl,
  roas,
  type PoliticaMarca,
  type PoliticaClaims,
  type CuentaCanal,
  type EntradaPlanner,
  type EntradasEconomia,
} from '../src/index';
import { desconocido, conocido } from '@soec/comercio';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const cuentaMetaOrgA: CuentaCanal = {
  organizationId: ORG_A,
  businessKey: 'biz-a',
  provider: 'meta',
  canal: 'META_INSTAGRAM',
  externalAccountId: 'act_123',
  displayName: 'IG A',
  capabilities: ['READ_INSIGHTS'],
  credentialRefs: ['file:org-a/meta-ig-token'],
  estado: 'CONNECTED_READ_ONLY',
};

describe('adquisición · aislamiento por tenant', () => {
  it('META_ACCOUNT_TENANT_SCOPED: una cuenta de otra org lanza, nunca se usa', () => {
    expect(() => assertCuentaDeTenant(cuentaMetaOrgA, ORG_A)).not.toThrow();
    expect(() => assertCuentaDeTenant(cuentaMetaOrgA, ORG_B)).toThrow(CuentaCruzadaError);
  });

  it('SMILEFLOW_META_CANNOT_USE_CYP_ACCOUNT / y viceversa: no hay fallback cross-tenant', () => {
    const cuentaCyp: CuentaCanal = { ...cuentaMetaOrgA, organizationId: 'org-cyp', businessKey: 'distribuidora-cyp' };
    expect(() => assertCuentaDeTenant(cuentaCyp, 'org-smileflow')).toThrow(CuentaCruzadaError);
    expect(() => assertCuentaDeTenant(cuentaMetaOrgA, 'org-cyp')).toThrow(CuentaCruzadaError);
  });

  it('UNKNOWN_CHANNEL_FAILS_CLOSED: una cuenta sin id/credencial es NO conectada', () => {
    const sin = cuentaNoConfigurada(ORG_A, 'biz-a', 'meta', 'META_FACEBOOK');
    expect(cuentaNoConectada(sin)).toBe(true);
    expect(sin.estado).toBe('NOT_CONFIGURED');
  });
});

describe('adquisición · NOT_CONNECTED ≠ ZERO', () => {
  it('NOT_CONNECTED_IS_NOT_ZERO: sin lectura, el volumen es null (no 0)', () => {
    expect(canalTieneLectura('NOT_CONFIGURED')).toBe(false);
    expect(volumenObservable('NOT_CONFIGURED', 0)).toBeNull();
    expect(volumenObservable('CONNECTED_READ_ONLY', 0)).toBe(0);
    expect(volumenObservable('CONNECTED_READ_ONLY', 42)).toBe(42);
  });
});

describe('adquisición · atribución', () => {
  it('ATTRIBUTION_UNKNOWN_REMAINS_UNKNOWN: sin señal, UNKNOWN; nunca se promueve a orgánico/directo', () => {
    const sinSenal = { ...ATRIBUCION_DESCONOCIDA };
    expect(clasificarNivelAtribucion(sinSenal)).toBe('UNKNOWN');
    expect(sostieneCanal(ATRIBUCION_DESCONOCIDA)).toBe(false);
  });

  it('la atribución sólo llega a DIRECT con clickId; a ATTRIBUTED con campaña; conservador', () => {
    const conClick = conNivelDerivado({ ...ATRIBUCION_DESCONOCIDA, clickId: 'fbclid-xyz' });
    expect(conClick.nivel).toBe('DIRECT');
    const conCampaign = conNivelDerivado({ ...ATRIBUCION_DESCONOCIDA, campaign: 'camp-1' });
    expect(conCampaign.nivel).toBe('ATTRIBUTED');
    const soloSource = conNivelDerivado({ ...ATRIBUCION_DESCONOCIDA, utm: { ...UTM_VACIO, source: 'ig' } });
    expect(soloSource.nivel).toBe('OBSERVED');
  });
});

describe('adquisición · leads sin PII', () => {
  it('NO_PII_LEAD: un email como externalLeadId se rechaza', () => {
    expect(() =>
      normalizarLead({ organizationId: ORG_A, source: 'meta-lead-ads', channel: 'META_INSTAGRAM', externalLeadId: 'juan@x.cl', createdAt: '2026-08-15T00:00:00Z' }),
    ).toThrow(LeadInvalidoError);
  });

  it('NO_PII_LEAD: PII en campos extra se rechaza', () => {
    expect(() =>
      normalizarLead({ organizationId: ORG_A, source: 'form', channel: 'WEBSITE', externalLeadId: 'lead-9', createdAt: '2026-08-15T00:00:00Z', extra: { telefono: '+56 9 1234 5678' } }),
    ).toThrow(LeadInvalidoError);
  });

  it('TEST_LEAD_EXCLUDED_FROM_COMMERCIAL: un lead esTest no cuenta como comercial', () => {
    const real = normalizarLead({ organizationId: ORG_A, source: 'meta-lead-ads', channel: 'META_INSTAGRAM', externalLeadId: 'lead-1', createdAt: '2026-08-15T00:00:00Z' });
    const test = normalizarLead({ organizationId: ORG_A, source: 'meta-lead-ads', channel: 'META_INSTAGRAM', externalLeadId: 'lead-2', createdAt: '2026-08-15T00:00:00Z', esTest: true });
    expect(cuentaComoComercial(real)).toBe(true);
    expect(cuentaComoComercial(test)).toBe(false);
    expect(identidadLead(real)).toBe('org-a:meta-lead-ads:lead-1');
  });
});

describe('adquisición · contenido y marca', () => {
  const politica: PoliticaMarca = {
    organizationId: ORG_A,
    businessKey: 'biz-a',
    tono: ['cercano'],
    ctasAprobados: ['Cotiza'],
    afirmacionesAprobadas: ['Despacho a todo Chile'],
    afirmacionesProhibidas: [],
    disclaimersObligatorios: [],
    temasProhibidos: [],
    temasAprobacionManual: ['salud'],
    version: 1,
  };
  const claims: PoliticaClaims = { organizationId: ORG_A, familiasReguladas: ['PRECIO'], familiasVetadas: ['PROMESA_CLINICA'] };

  it('CONTENT_WITHOUT_BRAND_POLICY_CANNOT_AUTOPUBLISH: sin BrandPolicy ⇒ DRAFT_ONLY', () => {
    expect(evaluarAutopublicacion(null, ['general'])).toEqual({ permite: 'DRAFT_ONLY', motivo: 'SIN_BRAND_POLICY' });
  });

  it('un tema de aprobación manual fuerza DRAFT_ONLY aun con política', () => {
    expect(evaluarAutopublicacion(politica, ['salud']).permite).toBe('DRAFT_ONLY');
    expect(evaluarAutopublicacion(politica, ['general']).permite).toBe('AUTOPUBLICABLE');
  });

  it('UNVERIFIED_CLAIM_BLOCKED: familia vetada bloquea; familia regulada exige texto aprobado', () => {
    expect(claimBloqueado(politica, claims, 'PROMESA_CLINICA', 'cura caries')).toBe(true);
    expect(claimBloqueado(politica, claims, 'PRECIO', 'precio inventado')).toBe(true);
    expect(claimBloqueado(politica, claims, 'PRECIO', 'Despacho a todo Chile')).toBe(false);
  });
});

describe('adquisición · PAID y planner', () => {
  it('PAID_ACTION_WITHOUT_BUDGET_POLICY_DENIED: sin StopLossPolicy no hay PAID autónomo', () => {
    expect(paidAutonomoPermitido(null)).toBe(false);
    expect(paidAutonomoPermitido({ organizationId: ORG_A, businessKey: 'b', maxGastoSinResultado: null, maxCPL: null, maxCAC: null, maxFrecuencia: null, senalMinima: null })).toBe(false);
    expect(paidAutonomoPermitido({ organizationId: ORG_A, businessKey: 'b', maxGastoSinResultado: 50000, maxCPL: null, maxCAC: null, maxFrecuencia: null, senalMinima: null })).toBe(true);
  });

  it('PAID_ACTION_WITHOUT_MEASUREMENT_DENIED: sin medición evaluable ⇒ FOUNDATION_REQUIRED', () => {
    const e: EntradaPlanner = {
      organizationId: 'org-cyp',
      objetivo: 'GENERATE_SALES',
      medicionEvaluable: false,
      canales: [{ canal: 'META_INSTAGRAM', estado: 'CONNECTED_READ_ONLY' }],
      tieneBrandPolicy: true,
      tieneStopLoss: true,
      tieneMandatoPresupuesto: true,
    };
    expect(planificarAdquisicion(e).tipo).toBe('FOUNDATION_REQUIRED');
  });

  it('ORGANIC_AND_PAID_AUTONOMY_INDEPENDENT: orgánico posible aunque falte StopLoss para pagado', () => {
    const e: EntradaPlanner = {
      organizationId: ORG_A,
      objetivo: 'GENERATE_LEADS',
      medicionEvaluable: true,
      canales: [
        { canal: 'ORGANIC_INSTAGRAM', estado: 'SHADOW_READY' },
        { canal: 'META_INSTAGRAM', estado: 'CONNECTED_READ_ONLY' },
      ],
      tieneBrandPolicy: true,
      tieneStopLoss: false,
      tieneMandatoPresupuesto: false,
    };
    const plan = planificarAdquisicion(e);
    expect(plan.tipo).toBe('ORGANIC_EXPERIMENT');
    expect(plan.razones.some((r) => r.includes('StopLossPolicy'))).toBe(true);
  });
});

describe('adquisición · resultados', () => {
  it('LEAD_COUNT_DOES_NOT_EQUAL_CUSTOMER_COUNT: un LEAD no es un CUSTOMER', () => {
    expect(leadNoEsCliente()).toBe(true);
    expect(rangoEmbudo('LEAD')).toBeLessThan(rangoEmbudo('CUSTOMER'));
  });

  it('ENGAGEMENT_DOES_NOT_EQUAL_COMMERCIAL_OUTCOME', () => {
    expect(esResultadoComercialFuerte('ENGAGEMENT')).toBe(false);
    expect(esResultadoComercialFuerte('PURCHASE')).toBe(true);
  });
});

describe('adquisición · campaña shadow + escritura Meta bloqueada', () => {
  it('PAID_CAMPAIGN_SHADOW_CREATES_ZERO_EXTERNAL_OBJECTS', () => {
    expect(sinEfectoExterno('SHADOW')).toBe(true);
    expect(sinEfectoExterno('DRAFT')).toBe(true);
    expect(sinEfectoExterno('ACTIVE')).toBe(false);
  });

  it('REAL_ACTION_FORBIDDEN_SHADOW_ALLOWED: clasificación inicial de toda acción social', () => {
    expect(clasificacionInicial('SOCIAL_POST_PUBLISH')).toEqual({ real: 'FORBIDDEN', shadow: 'ALLOWED' });
    expect(clasificacionInicial('PAID_CAMPAIGN_CREATE')).toEqual({ real: 'FORBIDDEN', shadow: 'ALLOWED' });
  });

  it('META_WRITE_WITHOUT_CREDENTIAL_FAILS_CLOSED / AUTONOMOUS_REAL_FALSE_BLOCKS_META_MUTATION', async () => {
    const w = new MetaWriteBloqueado(null, false);
    expect(w.estado()).toBe('NOT_READY');
    await expect(w.ejecutarReal({ organizationId: ORG_A, tipo: 'PAID_CAMPAIGN_CREATE', externalAccountId: 'act_1' })).rejects.toBeInstanceOf(MetaWriteBloqueadoError);
    // Aun con credencial presente, si AUTONOMOUS_REAL=false sigue bloqueada.
    const w2 = new MetaWriteBloqueado('file:org-a/meta-write', false);
    expect(w2.estado()).toBe('NOT_READY');
    await expect(w2.ejecutarReal({ organizationId: ORG_A, tipo: 'SOCIAL_POST_PUBLISH', externalAccountId: null })).rejects.toBeInstanceOf(MetaWriteBloqueadoError);
  });

  it('el puerto de lectura Meta por defecto está NO conectado y sin capacidades', async () => {
    const r = new MetaReadNoConectado('META_INSTAGRAM');
    expect(r.estado()).toBe('NOT_CONNECTED');
    expect(await r.detectarCapacidades()).toMatchObject({ puedeLeerInsights: false, puedeGestionarPagado: false });
  });
});

describe('adquisición · economía honesta', () => {
  it('UNKNOWN permanece UNKNOWN y denominador inválido ⇒ null', () => {
    const base: EntradasEconomia = {
      gasto: conocido(100000),
      leads: desconocido('NO_INSTRUMENTADO'),
      leadsCalificados: desconocido('NO_INSTRUMENTADO'),
      clientes: conocido(0),
      ingresos: desconocido('FUENTE_NO_CONECTADA'),
      ingresosTotales: desconocido('FUENTE_NO_CONECTADA'),
    };
    expect(cpl(base)).toMatchObject({ valor: null, motivo: 'ENTRADA_DESCONOCIDA' });
    // clientes = 0 ⇒ denominador inválido, no división por cero
    const conGasto: EntradasEconomia = { ...base, ingresos: conocido(0) };
    expect(roas(conGasto)).toMatchObject({ valor: 0, motivo: 'OK' });
  });
});
