/**
 * FASE 2B — el entry point productivo cablea el GoogleAdsRealMutatePort REAL (adaptador existente) sobre el
 * transporte HTTP de escritura, no un placeholder. Fail-closed: sin configuración ⇒ null.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { construirPuertoEscrituraGoogleAds } from '../src/campana/google-ads-write-runtime';
import { GoogleAdsRealMutatePort } from '../src/campana/google-ads-real-port';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const ctx: RequestContext = { organizationId: OrganizationId(ORG), actor: ActorId('canary'), scope: { organizationId: OrganizationId(ORG), permissions: ['events:read'] }, correlationId: 'c' };
const envConfig = { GOOGLE_ADS_DEVELOPER_TOKEN: 'dt', GOOGLE_ADS_CLIENT_ID: 'ci', GOOGLE_ADS_CLIENT_SECRET: 'cs' } as unknown as NodeJS.ProcessEnv;

describe('construirPuertoEscrituraGoogleAds', () => {
  it('configurado ⇒ GoogleAdsRealMutatePort REAL (adaptador Phase2B), no placeholder', () => {
    const port = construirPuertoEscrituraGoogleAds(envConfig, ORG, ctx);
    expect(port).toBeInstanceOf(GoogleAdsRealMutatePort);
    expect((port as GoogleAdsRealMutatePort).calls).toBe(0); // construido, nunca invocado
  });
  it('sin configuración ⇒ null (fail-closed)', () => {
    expect(construirPuertoEscrituraGoogleAds({} as NodeJS.ProcessEnv, ORG, ctx)).toBeNull();
  });
  it('org sin recurso google-ads ⇒ null', () => {
    expect(construirPuertoEscrituraGoogleAds(envConfig, 'org-inexistente', ctx)).toBeNull();
  });
});
