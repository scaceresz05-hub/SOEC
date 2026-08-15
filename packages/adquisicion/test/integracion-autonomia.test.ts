/**
 * Tests adversariales de INTEGRACIÓN con la autonomía existente (FASE 19).
 *
 * Certifican que las acciones de adquisición usan el MOTOR EXISTENTE (`clasificarAccion`,
 * `evaluarAccion`, catálogo `metaDeAccion`) y no un segundo motor; y que la autonomía es
 * independiente por canal/cuenta/tenant, fail-closed sin mandato.
 */
import { describe, expect, it } from 'vitest';
import {
  metaDeAccion,
  clasificarAccion,
  type MandatoAutonomia,
  type TipoAccion,
} from '@soec/autonomia';
import {
  resolverMandatoDeCanal,
  clasificarAccionDeCanal,
  nivelDeCanal,
  overlayDeAccionSocial,
  mapearReversibilidad,
  clasificacionInicial,
} from '../src/index';

function mandato(over: Partial<MandatoAutonomia> & Pick<MandatoAutonomia, 'organizationId' | 'businessKey' | 'externalAccountId'>): MandatoAutonomia {
  return {
    nivel: 'LEVEL_3_AUTONOMOUS',
    accionesPermitidas: [],
    accionesRequierenAprobacion: [],
    accionesProhibidas: [],
    limitesFinancieros: {},
    limitesCambio: {},
    politicaEvidencia: { muestraMinima: 0, ventanaMinimaHoras: 0 },
    politicaRollback: { exigirParaMutaciones: false, ventanaMedicionHoras: 0 },
    politicaMedicion: { ventanaHoras: 0, metricaObjetivo: '' },
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    createdBy: 'test',
    approvedBy: null,
    approvedAt: null,
    status: 'ACTIVE',
    version: 1,
    ...over,
  } as MandatoAutonomia;
}

describe('integración · las acciones de adquisición usan el motor existente', () => {
  it('ACQUISITION_ACTIONS_USE_EXISTING_AUTONOMY_ENGINE: las sociales están en el catálogo canónico', () => {
    // metaDeAccion es del motor existente (@soec/autonomia), no de un catálogo propio.
    expect(metaDeAccion('SOCIAL_POST_PUBLISH').reversibilidad).toBe('PARTIALLY_REVERSIBLE');
    expect(metaDeAccion('PAID_BUDGET_ADJUST').financiera).toBe(true);
    // El overlay de adquisición delega los flags intrínsecos al catálogo canónico.
    const canonico = metaDeAccion('PAID_BUDGET_ADJUST');
    expect(mapearReversibilidad('PAID_BUDGET_ADJUST')).toEqual({ reversibilidad: canonico.reversibilidad, financiera: canonico.financiera, aumentaGasto: canonico.aumentaGasto });
    // El overlay sólo añade naturaleza + riesgo.
    expect(overlayDeAccionSocial('PAID_BUDGET_ADJUST')).toMatchObject({ naturaleza: 'PAID_WRITE', riesgo: 'CRITICAL' });
  });

  it('NO_SECOND_MANDATE_ENGINE: la clasificación por canal reutiliza clasificarAccion', () => {
    const m = mandato({ organizationId: 'org-a', businessKey: 'b', externalAccountId: 'acc-1', canal: 'ORGANIC_INSTAGRAM', accionesPermitidas: ['SOCIAL_POST_PUBLISH'] });
    expect(clasificarAccion(m, 'SOCIAL_POST_PUBLISH')).toBe('AUTONOMOUS');
    expect(clasificarAccionDeCanal([m], { organizationId: 'org-a', businessKey: 'b', canal: 'ORGANIC_INSTAGRAM', externalAccountId: 'acc-1' }, 'SOCIAL_POST_PUBLISH')).toBe('AUTONOMOUS');
  });
});

describe('integración · independencia de autonomía por canal/tenant', () => {
  const organico = mandato({ organizationId: 'org-a', businessKey: 'b', externalAccountId: 'ig-1', canal: 'ORGANIC_INSTAGRAM', nivel: 'LEVEL_3_AUTONOMOUS', accionesPermitidas: ['SOCIAL_POST_PUBLISH'] });
  const pagado = mandato({ organizationId: 'org-a', businessKey: 'b', externalAccountId: 'ads-1', canal: 'META_INSTAGRAM', nivel: 'LEVEL_1_RECOMMEND' });
  const google = mandato({ organizationId: 'org-a', businessKey: 'b', externalAccountId: 'gads-1', canal: 'GOOGLE_SEARCH', nivel: 'LEVEL_2_APPROVAL_REQUIRED' });
  const mandatos = [organico, pagado, google];

  it('ORGANIC_AUTONOMY_INDEPENDENT_FROM_PAID: autorizar orgánico no habilita el pagado', () => {
    expect(nivelDeCanal(mandatos, { organizationId: 'org-a', businessKey: 'b', canal: 'ORGANIC_INSTAGRAM', externalAccountId: 'ig-1' })).toBe('LEVEL_3_AUTONOMOUS');
    expect(nivelDeCanal(mandatos, { organizationId: 'org-a', businessKey: 'b', canal: 'META_INSTAGRAM', externalAccountId: 'ads-1' })).toBe('LEVEL_1_RECOMMEND');
    // Publicar orgánico está permitido; pero el canal pagado NO hereda ese permiso.
    expect(clasificarAccionDeCanal(mandatos, { organizationId: 'org-a', businessKey: 'b', canal: 'META_INSTAGRAM', externalAccountId: 'ads-1' }, 'SOCIAL_POST_PUBLISH')).toBe('NOT_IN_MANDATE');
  });

  it('META_AUTONOMY_INDEPENDENT_FROM_GOOGLE', () => {
    expect(nivelDeCanal(mandatos, { organizationId: 'org-a', businessKey: 'b', canal: 'GOOGLE_SEARCH', externalAccountId: 'gads-1' })).toBe('LEVEL_2_APPROVAL_REQUIRED');
    expect(nivelDeCanal(mandatos, { organizationId: 'org-a', businessKey: 'b', canal: 'META_INSTAGRAM', externalAccountId: 'ads-1' })).toBe('LEVEL_1_RECOMMEND');
  });

  it('SMILEFLOW_CANNOT_READ_CYP_CHANNELS / y viceversa: sin mandato del tenant ⇒ fail-closed', () => {
    const soloSmileflow = [mandato({ organizationId: 'org-smileflow', businessKey: 'smileflow-clinic', externalAccountId: 'ig-sf', canal: 'ORGANIC_INSTAGRAM', accionesPermitidas: ['SOCIAL_POST_PUBLISH'] })];
    // C Y P no encuentra el mandato de SmileFlow: null, nivel más conservador, acción fuera de mandato.
    const criterioCyp = { organizationId: 'org-cyp', businessKey: 'distribuidora-cyp', canal: 'ORGANIC_INSTAGRAM', externalAccountId: 'ig-sf' };
    expect(resolverMandatoDeCanal(soloSmileflow, criterioCyp)).toBeNull();
    expect(nivelDeCanal(soloSmileflow, criterioCyp)).toBe('LEVEL_0_OBSERVE');
    expect(clasificarAccionDeCanal(soloSmileflow, criterioCyp, 'SOCIAL_POST_PUBLISH')).toBe('NOT_IN_MANDATE');
  });

  it('UNKNOWN_CHANNEL_FAILS_CLOSED: canal sin mandato ⇒ NOT_IN_MANDATE, nunca hereda otro canal', () => {
    expect(clasificarAccionDeCanal(mandatos, { organizationId: 'org-a', businessKey: 'b', canal: 'WHATSAPP', externalAccountId: 'x' }, 'SOCIAL_POST_PUBLISH')).toBe('NOT_IN_MANDATE');
  });

  it('REAL_ACTION_FORBIDDEN_SHADOW_ALLOWED se mantiene tras la integración', () => {
    const tipos: TipoAccion[] = ['SOCIAL_POST_PUBLISH', 'PAID_CAMPAIGN_CREATE', 'PAID_BUDGET_ADJUST'];
    for (const t of tipos) {
      expect(clasificacionInicial(t as Parameters<typeof clasificacionInicial>[0])).toEqual({ real: 'FORBIDDEN', shadow: 'ALLOWED' });
    }
  });
});
