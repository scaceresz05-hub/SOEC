import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildEmulador, EstadoEmulador, TOKEN_DEMO } from '@soec/canal-emulado';
import { AdaptadorCanalEmulado, type ContextoEnvio, type CredencialResuelta } from '../src';

const estado = new EstadoEmulador();
const { app } = buildEmulador(estado);
let baseUrl = '';
let adapter: AdaptadorCanalEmulado;

const cred: CredencialResuelta = { ref: { organizationId: 'orgA', canal: 'blog', cuentaLogica: 'cuenta-demo', credencialId: 'cred-demo' }, token: TOKEN_DEMO, vigente: true };
function ctxEnvio(idem: string): ContextoEnvio {
  return {
    idempotencyKey: idem,
    credencial: cred,
    capacidades: { canal: 'blog', publicaTexto: true, publicaImagen: false, publicaVideo: false, soportaBorradores: false, soportaProgramacion: true, soportaEdicion: false, soportaEliminacion: true, soportaConsulta: true, soportaWebhooks: true, exigeArchivoRealParaImagen: false, limiteCuerpo: 0, estadosRemotos: [] },
    payload: { canal: 'blog', formato: 'articulo', content: 'contenido de prueba', title: 'título', altText: 'alt', hashtags: [], llamadaAccion: 'cta', urlObjetivo: '', assetsReales: 0, requiereArchivoReal: false, huella: 'h1', mapperVersion: 'm1' },
  };
}

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  adapter = new AdaptadorCanalEmulado(baseUrl, 1500);
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => estado.reset());

describe('Adaptador emulado por HTTP (frontera de red real)', () => {
  it('publica con éxito y devuelve una referencia externa verificable', async () => {
    const r = await adapter.enviar(ctxEnvio('idem-a'));
    expect(r.resultado).toBe('publicada');
    expect(r.externalRef).toBeTruthy();
    const v = await adapter.verificar(r.externalRef!, cred);
    expect(v.existe).toBe(true);
    expect(v.status).toBe('published');
  });

  it('idempotencia externa: la misma clave nunca crea dos publicaciones', async () => {
    const r1 = await adapter.enviar(ctxEnvio('idem-dup'));
    const r2 = await adapter.enviar(ctxEnvio('idem-dup'));
    expect(r2.externalRef).toBe(r1.externalRef);
    expect(estado.posts.size).toBe(1);
  });

  it('timeout tras crear: respuesta perdida → desconocida; el objeto existe en el proveedor', async () => {
    estado.setEscenario('timeout_after_create');
    const r = await adapter.enviar(ctxEnvio('idem-timeout'));
    expect(r.resultado).toBe('desconocida');
    const encontrado = await adapter.buscarPorIdempotencia('idem-timeout', cred);
    expect(encontrado?.existe).toBe(true);
  });

  it('rate limit: devuelve rate_limited con Retry-After y no crea publicación', async () => {
    estado.setEscenario('rate_limit');
    const r = await adapter.enviar(ctxEnvio('idem-rl'));
    expect(r.resultado).toBe('rate_limited');
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(estado.posts.size).toBe(0);
  });

  it('credencial inválida y payload inválido se traducen a fallo, sin publicar', async () => {
    estado.setEscenario('invalid_credential');
    expect((await adapter.enviar(ctxEnvio('idem-c'))).resultado).toBe('fallida');
    estado.reset();
    estado.setEscenario('invalid_payload');
    expect((await adapter.enviar(ctxEnvio('idem-p'))).resultado).toBe('fallida');
    expect(estado.posts.size).toBe(0);
  });

  it('retira una publicación existente', async () => {
    const r = await adapter.enviar(ctxEnvio('idem-del'));
    const del = await adapter.retirar(r.externalRef!, cred);
    expect(del.ok).toBe(true);
    expect((await adapter.verificar(r.externalRef!, cred)).existe).toBe(false);
  });
});
