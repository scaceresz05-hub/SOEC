import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { InMemoryEventStore } from '@soec/event-store';
import { buildEmulador, EstadoEmulador } from '@soec/canal-emulado';
import { AdaptadorCanalEmulado, SECRETO_WEBHOOK_DEV, type WebhookEntrante } from '../src';
import { attr, ctxFor, montar, now, publicarCmd, sembrarPaquete } from './helpers';

const estado = new EstadoEmulador();
const { app } = buildEmulador(estado);
let adapter: AdaptadorCanalEmulado;

function webhook(externalRef: string, status: string, id = 'wh-1'): WebhookEntrante {
  const firma = createHmac('sha256', SECRETO_WEBHOOK_DEV).update(JSON.stringify({ tipo: 'post.published', externalId: externalRef, status })).digest('hex');
  return { id, tipo: 'post.published', externalRef, status, firma };
}

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  adapter = new AdaptadorCanalEmulado(`http://127.0.0.1:${addr.port}`, 1500);
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => estado.reset());

describe('Vertical de publicación controlada (paquete → autorización → adaptador → proveedor emulado → verificación)', () => {
  it('Caso A — publicación textual exitosa y verificada', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    expect(pub.estado).toBe('verificada');
    expect(pub.externalRef).toBeTruthy();
    expect(pub.estadoRemoto).toBe('published');
  });

  it('Caso B — timeout tras creación: reconcilia sin duplicar', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    estado.setEscenario('timeout_after_create');
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    expect(pub.reconciliaciones.length).toBeGreaterThan(0);
    expect(pub.estado).toBe('verificada');
    expect(estado.posts.size).toBe(1); // no se duplicó
  });

  it('Caso C — rate limit: respeta el límite y no duplica; reintento posterior publica', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    estado.setEscenario('rate_limit');
    const pub1 = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    expect(pub1.estado).toBe('fallida');
    expect(estado.posts.size).toBe(0);
    estado.setEscenario('success_immediate');
    const pub2 = await m.publicaciones.enviar(ctx, pub1.publicationId, attr, now);
    expect(pub2.estado).toBe('verificada');
    expect(estado.posts.size).toBe(1);
  });

  it('Caso D — canal exige imagen real: solo hay especificación → bloqueada, sin envío', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-instagram-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'instagram', 'sandbox'));
    expect(pub.estado).toBe('bloqueada');
    expect(pub.motivoBloqueo).toBe('activo_real_faltante');
    expect(estado.posts.size).toBe(0);
  });

  it('Caso E — webhook duplicado y fuera de orden: deduplica y no retrocede el estado', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    estado.setEscenario('processing_async');
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    expect(['aceptada', 'procesando']).toContain(pub.estado);
    const ref = pub.externalRef!;
    const w1 = await m.webhooks.procesar(ctx, webhook(ref, 'published', 'wh-a'), attr, now);
    expect(w1.resultado).toBe('aplicado');
    expect((await m.publicaciones.cargar(ctx, pub.publicationId)).estado).toBe('verificada');
    const dup = await m.webhooks.procesar(ctx, webhook(ref, 'published', 'wh-a'), attr, now);
    expect(dup.resultado).toBe('duplicado');
    const viejo = await m.webhooks.procesar(ctx, webhook(ref, 'processing', 'wh-b'), attr, now);
    expect(viejo.resultado).toBe('sin_efecto'); // no retrocede verificada → procesando
    expect((await m.publicaciones.cargar(ctx, pub.publicationId)).estado).toBe('verificada');
  });

  it('Caso F — retiro: elimina la publicación y verifica el retiro', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    const ret = await m.publicaciones.retirar(ctx, pub.publicationId, 'retiro de prueba', attr, now);
    expect(ret.estado).toBe('retirada');
    expect((await adapter.verificar(pub.externalRef!, { ref: { organizationId: String(ctx.organizationId), canal: 'blog', cuentaLogica: 'cuenta-demo', credencialId: 'cred-demo' }, token: 'emu-token-valido-dev', vigente: true })).existe).toBe(false);
  });

  it('Caso G — credencial revocada: bloqueada, sin envío ni filtración', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    m.credenciales.revocar({ organizationId: String(ctx.organizationId), canal: 'blog', cuentaLogica: 'cuenta-demo', credencialId: 'cred-demo' });
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    expect(pub.estado).toBe('bloqueada');
    expect(pub.motivoBloqueo).toBe('credencial_no_vigente');
    expect(estado.posts.size).toBe(0);
  });

  it('idempotencia por identidad de publicación y aislamiento por organización', async () => {
    const m = montar(new InMemoryEventStore(), adapter);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const p1 = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    const p2 = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'sandbox'));
    expect(p2.externalRef).toBe(p1.externalRef);
    expect(estado.posts.size).toBe(1);
    expect((await m.publicaciones.cargar(ctxFor('otra-org'), p1.publicationId)).existe).toBe(false);
  });
});
