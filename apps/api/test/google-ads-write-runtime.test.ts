/**
 * FASE 2B — el entry point productivo cablea el GoogleAdsRealMutatePort REAL (adaptador existente) sobre el
 * transporte HTTP de escritura, con el token resuelto por la CONEXIÓN (composición), no por env. Fail-closed:
 * sin composición o sin developer-token ⇒ null.
 */
import { describe, expect, it } from 'vitest';
import type { ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';
import { construirPuertoEscrituraGoogleAds } from '../src/campana/google-ads-write-runtime';
import { GoogleAdsRealMutatePort } from '../src/campana/google-ads-real-port';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const comp = {} as ComponentesFlujoGoogleAds; // sólo se usa lazy al resolver el token (no en la construcción)
const envConfig = { GOOGLE_ADS_DEVELOPER_TOKEN: 'dt', GOOGLE_ADS_CLIENT_ID: 'ci', GOOGLE_ADS_CLIENT_SECRET: 'cs' } as unknown as NodeJS.ProcessEnv;

describe('construirPuertoEscrituraGoogleAds', () => {
  it('composición + developer-token ⇒ GoogleAdsRealMutatePort real (token vía conexión, no env)', () => {
    const port = construirPuertoEscrituraGoogleAds(envConfig, ORG, comp);
    expect(port).toBeInstanceOf(GoogleAdsRealMutatePort);
    expect((port as GoogleAdsRealMutatePort).calls).toBe(0); // construido, nunca invocado
  });
  it('sin composición ⇒ null (fail-closed)', () => {
    expect(construirPuertoEscrituraGoogleAds(envConfig, ORG, null)).toBeNull();
  });
  it('sin developer-token ⇒ null', () => {
    expect(construirPuertoEscrituraGoogleAds({} as NodeJS.ProcessEnv, ORG, comp)).toBeNull();
  });
  it('org sin recurso google-ads ⇒ null', () => {
    expect(construirPuertoEscrituraGoogleAds(envConfig, 'org-inexistente', comp)).toBeNull();
  });
});
