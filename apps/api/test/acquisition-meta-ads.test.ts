/**
 * Meta Ads read — money, delivery vs status, lead semantics, provenance, tenant isolation, token
 * sanitization (FASE 18). Sin red. Tokens SINTÉTICOS.
 */
import { describe, expect, it } from 'vitest';
import {
  dinero,
  assertMismaMoneda,
  claveCampana,
  deliveryStateDesdeCampaign,
  CUENTA_ADS_SMILEFLOW,
  CAMPANAS_ADS_SMILEFLOW,
  INSIGHTS_ADS_SMILEFLOW,
  CAPACIDAD_LEAD_ADS_SMILEFLOW,
  ADS_READ_CAPABILITY,
  ADS_WRITE_ADAPTER,
  LEADS_RETRIEVAL_PERMISSION,
  ORGANIZATION_CONNECTION_STATUS,
  PRODUCTION_AUTHORIZATION,
} from '../src/acquisition/meta-ads';
import { sanitizarGraph } from '../src/acquisition/meta-organic';

const TOKEN = 'SYNTH_ADS_TOKEN_987zzz';

describe('Ads · dinero con moneda (CLP ≠ USD)', () => {
  it('spend conserva moneda; CLP no es USD', () => {
    expect(INSIGHTS_ADS_SMILEFLOW.spend.dinero).toEqual({ amount: 9741, currency: 'CLP' });
    expect(INSIGHTS_ADS_SMILEFLOW.spend.dinero?.currency).not.toBe('USD');
    expect(CUENTA_ADS_SMILEFLOW.currency).toBe('CLP');
    expect(CUENTA_ADS_SMILEFLOW.timezoneName).toBe('America/Santiago');
  });
  it('mezclar monedas distintas lanza; moneda inválida lanza', () => {
    expect(() => assertMismaMoneda(dinero(1, 'CLP'), dinero(1, 'USD'))).toThrow();
    expect(() => dinero(1, 'DOLARES')).toThrow();
  });
});

describe('Ads · ACTIVE ≠ DELIVERING (no inferir entrega del status)', () => {
  it('deliveryStateDesdeCampaign nunca devuelve DELIVERING; con evidencia de campaña ⇒ NOT_OBSERVED', () => {
    expect(deliveryStateDesdeCampaign('ACTIVE', 'ACTIVE')).toBe('NOT_OBSERVED');
    const activa = CAMPANAS_ADS_SMILEFLOW.find((c) => c.externalCampaignId === '120246449950670097');
    expect(activa?.effectiveStatus).toBe('ACTIVE');
    expect(activa?.deliveryState).toBe('NOT_OBSERVED'); // ACTIVE no prueba entrega
    expect(activa?.deliveryState).not.toBe('DELIVERING');
  });
});

describe('Ads · lead semantics y ownership', () => {
  it('OUTCOME_LEADS existe pero NO implica lead retrieval ni PII', () => {
    expect(CAPACIDAD_LEAD_ADS_SMILEFLOW.hasLeadObjectiveCampaign).toBe(true);
    expect(CAPACIDAD_LEAD_ADS_SMILEFLOW.leadRetrievalCapability).toBe('NOT_TESTED');
    expect(CAPACIDAD_LEAD_ADS_SMILEFLOW.piiAvailable).toBe('NOT_READ');
    const messages = CAMPANAS_ADS_SMILEFLOW.find((c) => c.objective === 'MESSAGES');
    expect(messages?.hasLeadObjective).toBe(false);
  });
  it('business field ausente NO es ownership personal verificado', () => {
    expect(CUENTA_ADS_SMILEFLOW.businessRelationship).toBe('NO_BUSINESS_FIELD');
    expect(CUENTA_ADS_SMILEFLOW.businessRelationship).not.toBe('VERIFIED_PERSONAL');
  });
});

describe('Ads · provenance de rango y actions', () => {
  it('MAXIMUM ≠ LAST_90_DAYS; se conserva el rango devuelto', () => {
    expect(INSIGHTS_ADS_SMILEFLOW.provenance.requestedRangeType).toBe('MAXIMUM');
    expect(INSIGHTS_ADS_SMILEFLOW.provenance.requestedRangeType).not.toBe('LAST_90_DAYS');
    expect(INSIGHTS_ADS_SMILEFLOW.provenance.returnedDateStart).toBe('2023-07-31');
  });
  it('actions NOT_TESTED no se convierte en [] (evidencia de cero)', () => {
    expect(INSIGHTS_ADS_SMILEFLOW.actions).toBe('NOT_TESTED');
    expect(Array.isArray(INSIGHTS_ADS_SMILEFLOW.actions)).toBe(false); // no es [] (evidencia de cero)
  });
});

describe('Ads · aislamiento por tenant', () => {
  it('misma campaignId / adAccount en dos orgs NO colisiona', () => {
    const a = claveCampana({ organizationId: 'org-smileflow', provider: 'meta', externalAdAccountId: '1037025024374407', externalCampaignId: 'C1' });
    const b = claveCampana({ organizationId: 'org-cyp', provider: 'meta', externalAdAccountId: '1037025024374407', externalCampaignId: 'C1' });
    expect(a).not.toBe(b);
    expect(a).toBe('org-smileflow:meta:1037025024374407:C1');
  });
});

describe('Ads · sanitización de tokens (reusa el sanitizer central)', () => {
  it('respuestas sintéticas de /campaigns y /insights con paging quedan saneadas', () => {
    const campaigns = {
      data: [{ id: '120246449950670097', status: 'ACTIVE' }],
      paging: { cursors: { after: 'AFT' }, next: `https://graph.facebook.com/act_1/campaigns?access_token=${TOKEN}` },
    };
    const insights = {
      data: [{ spend: '9741' }],
      paging: { cursors: { after: 'AFT2' }, previous: `https://graph.facebook.com/act_1/insights?appsecret_proof=${TOKEN}` },
    };
    for (const env of [campaigns, insights]) {
      const s = sanitizarGraph(env) as { paging: unknown };
      expect(JSON.stringify(s)).not.toContain(TOKEN);
      expect(s.paging).not.toHaveProperty('next');
      expect(s.paging).not.toHaveProperty('previous');
    }
  });
});

describe('Ads · read ╪ write ╪ authorization', () => {
  it('ads_read PASS no desbloquea write ni conecta/autoriza a SOEC', () => {
    expect(ADS_READ_CAPABILITY).toBe('AVAILABLE');
    expect(ADS_WRITE_ADAPTER).toBe('LOCKED');
    expect(LEADS_RETRIEVAL_PERMISSION).toBe('NOT_GRANTED');
    expect(ORGANIZATION_CONNECTION_STATUS).toBe('NOT_CONNECTED');
    expect(PRODUCTION_AUTHORIZATION).toBe('NOT_GRANTED');
  });
});
