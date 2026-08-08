import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import type { EsquemaSalida } from '@soec/adaptadores';
import { SmileFlowGrowthAdapter } from '../src/ingesta/smileflow-growth-adapter';

const TOKEN = 'token-secreto-super-privado';
const HOST_OK = 'https://smileflow-clinic-production.up.railway.app';

const ESQUEMA: EsquemaSalida = {
  operacion: 'growth-events',
  campos: [
    { nombre: 'cursor', tipo: 'string' },
    { nombre: 'limit', tipo: 'string' },
  ],
};

function ctx(): RequestContext {
  const o = OrganizationId('org-smileflow');
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

function secretStore(): SecretStoreEnv {
  return new SecretStoreEnv({ SMILEFLOW_GROWTH_TOKEN: TOKEN });
}

function solicitud() {
  return {
    solicitudId: 's1',
    capacidadId: 'ingesta-growth',
    peticion: { operacion: 'growth-events', parametros: { cursor: '0', limit: '50' } },
  };
}

describe('SmileFlowGrowthAdapter', () => {
  it('host autorizado: ejecuta, envía el token en el header y devuelve el body (sin filtrar el token)', async () => {
    let tokenRecibido: string | null = null;
    let urlRecibida = '';
    const fetchFn = (async (input: string | URL, init?: RequestInit) => {
      urlRecibida = String(input);
      tokenRecibido = String((init?.headers as Record<string, string>)['X-Ingest-Token']);
      return new Response('{"ok":true,"datos":[],"next_cursor":null}', { status: 200 });
    }) as typeof fetch;

    const adapter = new SmileFlowGrowthAdapter({ secretStore: secretStore(), secretRef: 'env:SMILEFLOW_GROWTH_TOKEN', esquemaEgress: ESQUEMA, baseUrl: HOST_OK, fetchFn });
    const res = await adapter.ejecutar(ctx(), solicitud());

    expect(res.estado).toBe('OK');
    expect(res.salida?.body).toContain('next_cursor');
    // el token viajó en el header pero NO aparece en la salida ni en la URL
    expect(tokenRecibido).toBe(TOKEN);
    expect(urlRecibida).toContain('cursor=0');
    expect(urlRecibida).toContain('limit=50');
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    expect(urlRecibida).not.toContain(TOKEN);
  });

  it('host NO autorizado: ERROR por default-deny y no invoca fetch', async () => {
    let llamado = false;
    const fetchFn = (async () => {
      llamado = true;
      return new Response('nope', { status: 200 });
    }) as typeof fetch;

    const adapter = new SmileFlowGrowthAdapter({ secretStore: secretStore(), secretRef: 'env:SMILEFLOW_GROWTH_TOKEN', esquemaEgress: ESQUEMA, baseUrl: 'https://evil.example.com', fetchFn });
    const res = await adapter.ejecutar(ctx(), solicitud());

    expect(res.estado).toBe('ERROR');
    expect(res.error?.clase).toBe('NO_AUTORIZADO');
    expect(res.salida).toBeNull();
    expect(llamado).toBe(false);
  });

  it('respuesta no-ok: ERROR normalizado, sin filtrar el token', async () => {
    const fetchFn = (async () => new Response('boom', { status: 503 })) as typeof fetch;
    const adapter = new SmileFlowGrowthAdapter({ secretStore: secretStore(), secretRef: 'env:SMILEFLOW_GROWTH_TOKEN', esquemaEgress: ESQUEMA, baseUrl: HOST_OK, fetchFn });
    const res = await adapter.ejecutar(ctx(), solicitud());
    expect(res.estado).toBe('ERROR');
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });
});
