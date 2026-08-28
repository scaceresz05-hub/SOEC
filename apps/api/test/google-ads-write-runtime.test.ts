/**
 * FASE 2B — el entry point productivo cablea el GoogleAdsRealMutatePort REAL (adaptador existente) sobre el
 * transporte HTTP de escritura, con el token resuelto por la CONEXIÓN (composición), no por env. Fail-closed:
 * sin composición o sin developer-token ⇒ null.
 */
import { describe, expect, it } from 'vitest';
import type { ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';
import { construirPuertoEscrituraGoogleAds, resolverGeoRegiones } from '../src/campana/google-ads-write-runtime';
import { GoogleAdsRealMutatePort } from '../src/campana/google-ads-real-port';
import { GoogleAdsMutateHttpClient } from '../src/campana/google-ads-mutate-http';
import { GEO_SMILEFLOW_V2 } from '../src/campana/geo-policy';
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

describe('resolverGeoRegiones (SuggestGeoTargetConstants)', () => {
  it('resuelve las 5 regiones (4 positivas + RM negativa) a criterionId de nivel Region · sin faltantes', async () => {
    const ids: Record<string, string> = { 'Tarapacá': '20154', 'Antofagasta': '20155', 'La Araucanía': '20162', 'Los Lagos': '20164', 'Región Metropolitana de Santiago': '20161' };
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const nombre = (JSON.parse(init.body as string) as { locationNames: { names: string[] } }).locationNames.names[0]!;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '', json: async () => ({ geoTargetConstantSuggestions: [{ geoTargetConstant: { id: ids[nombre] ?? '0', name: nombre, canonicalName: `${nombre},Chile`, targetType: 'Region', countryCode: 'CL', status: 'ENABLED' } }] }) };
    }) as unknown as typeof fetch;
    const client = new GoogleAdsMutateHttpClient({ resolverAccessToken: async () => 'AT', developerToken: 'DT', loginCustomerId: '1742063041', fetchFn });
    const { resueltas, faltantes } = await resolverGeoRegiones(client, GEO_SMILEFLOW_V2);
    expect(faltantes).toEqual([]);
    expect(resueltas.length).toBe(5);
    expect(resueltas.filter((r) => !r.negativa).map((r) => r.criterionId).sort()).toEqual(['20154', '20155', '20162', '20164']);
    expect(resueltas.find((r) => r.negativa)?.criterionId).toBe('20161'); // RM
  });
});
