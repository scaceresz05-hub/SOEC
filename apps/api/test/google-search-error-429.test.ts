/**
 * Diagnóstico 429 · el error de lectura conserva la PISTA cuando Google no devuelve un fallo estructurado.
 *
 * El 429 de producción llegó como `GOOGLE_SEARCH_HTTP_429:req=…`, sin `status` ni `code`: el cuerpo no era un
 * `GoogleAdsFailure`, así que no quedó registro de QUÉ límite se aplicó. Ahora se guarda un resumen del
 * cuerpo (recortado y sin etiquetas) sólo cuando no hay detalle estructurado.
 */
import { describe, expect, it } from 'vitest';
import { GoogleAdsMutateHttpClient, GoogleSearchError } from '../src/campana/google-ads-mutate-http';

const clienteCon = (status: number, body: string) =>
  new GoogleAdsMutateHttpClient({
    resolverAccessToken: async () => 'token-efimero',
    developerToken: 'dev',
    loginCustomerId: '123',
    fetchFn: (async () => ({
      ok: false,
      status,
      headers: new Headers({ 'request-id': 'REQ-429' }),
      text: async () => body,
    })) as unknown as typeof fetch,
  });

describe('GoogleSearchError · 429 sin GoogleAdsFailure', () => {
  it('conserva un resumen del cuerpo y el request id', async () => {
    const cliente = clienteCon(429, '<html><head><title>429</title></head><body>Resource has been exhausted (e.g. check quota).</body></html>');
    const e = await cliente.buscar('8605539300', 'SELECT campaign.id FROM campaign').then(() => null, (x: unknown) => x as GoogleSearchError);
    expect(e).toBeInstanceOf(GoogleSearchError);
    expect(e!.detalle.httpStatus).toBe(429);
    expect(e!.detalle.requestId).toBe('REQ-429');
    expect(e!.detalle.cuerpoResumen).toContain('Resource has been exhausted');
    expect(e!.message).toContain('cuerpo=');
    expect(e!.detalle.cuerpoResumen!.length).toBeLessThanOrEqual(200);
  });

  it('con fallo estructurado usa el status/code de Google y NO añade el cuerpo', async () => {
    const cuerpo = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests', details: [{ errors: [{ errorCode: { quotaError: 'RESOURCE_TEMPORARILY_EXHAUSTED' }, message: 'Too many requests' }] }] } });
    const cliente = clienteCon(429, cuerpo);
    const e = await cliente.buscar('8605539300', 'SELECT campaign.id FROM campaign').then(() => null, (x: unknown) => x as GoogleSearchError);
    expect(e!.detalle.status).toBe('RESOURCE_EXHAUSTED');
    expect(e!.detalle.cuerpoResumen).toBeNull();
    expect(e!.message).toContain('RESOURCE_EXHAUSTED');
    expect(e!.message).not.toContain('cuerpo=');
  });

  it('el resumen no arrastra la consulta ni cabeceras: sólo el cuerpo de la respuesta', async () => {
    const cliente = clienteCon(429, 'quota exceeded for developer token');
    const e = await cliente.buscar('8605539300', 'SELECT campaign.id FROM campaign WHERE campaign.id = 24194332264').then(() => null, (x: unknown) => x as GoogleSearchError);
    expect(e!.detalle.cuerpoResumen).toBe('quota exceeded for developer token');
    expect(e!.message).not.toContain('24194332264');
    expect(e!.message).not.toContain('Bearer');
  });
});
