import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { ConcurrencyError } from '@soec/contracts';
import { makePool, runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { contenidoMigrations } from '@soec/contenido/pg';
import { SECRETO_WEBHOOK_DEV, pubStreamId, type WebhookEntrante } from '../../src';
import { canalesMigrations, PgPublicationProjectionStore, drenarCanales, reconstruirProyeccionesCanales } from '../../src/pg';
import { attr, ctxFor, montar, now, publicarCmd, sembrarPaquete } from '../helpers';

const CADENA = [...migracionesHastaCapacidades, ...operacionalMigrations, ...marketingMigrations, ...contenidoMigrations, ...canalesMigrations];
const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);

function webhook(externalRef: string, status: string, id: string): WebhookEntrante {
  const firma = createHmac('sha256', SECRETO_WEBHOOK_DEV).update(JSON.stringify({ tipo: 'post.published', externalId: externalRef, status })).digest('hex');
  return { id, tipo: 'post.published', externalRef, status, firma };
}

beforeAll(async () => {
  await runMigrations(pool, CADENA);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(
    `truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current,
       proj_capdef_current, proj_capexec_current, proj_policy_current, proj_accion_current, proj_objetivo_current, proj_plan_current,
       proj_brief_current, proj_paquete_current, proj_publicacion_current
     restart identity cascade`,
  );
});

describe('Plano de canales sobre PostgreSQL real (modo simulado, sin red)', () => {
  it('publica (simulado), verifica y persiste con referencia externa', async () => {
    const m = montar(store);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    expect(pub.estado).toBe('verificada');
    expect(pub.externalRef).toBeTruthy();
    const relee = await m.publicaciones.cargar(ctx, pub.publicationId);
    expect(relee.estado).toBe('verificada');
  });

  it('idempotencia por identidad de publicación: no reenvía ni duplica', async () => {
    const m = montar(store);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const p1 = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    const p2 = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    expect(p2.externalRef).toBe(p1.externalRef);
    expect(p2.intentos.length).toBe(p1.intentos.length);
  });

  it('procesa un webhook y deduplica el replay', async () => {
    const m = montar(store);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    const w1 = await m.webhooks.procesar(ctx, webhook(pub.externalRef!, 'published', 'wh-x'), attr, now);
    expect(['aplicado', 'sin_efecto']).toContain(w1.resultado);
    const dup = await m.webhooks.procesar(ctx, webhook(pub.externalRef!, 'published', 'wh-x'), attr, now);
    expect(dup.resultado).toBe('duplicado');
  });

  it('worker: proyecta la publicación; reconstruye desde cero idéntico', async () => {
    const m = montar(store);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    const outbox = new PgOutbox(pool);
    const stores = { publicacion: new PgPublicationProjectionStore(pool) };
    const n = await drenarCanales(outbox, stores);
    expect(n).toBeGreaterThan(0);
    const antes = await stores.publicacion.list(String(ctx.organizationId));
    expect(antes.length).toBeGreaterThan(0);
    await reconstruirProyeccionesCanales(pool);
    expect(await stores.publicacion.list(String(ctx.organizationId))).toEqual(antes);
  });

  it('concurrencia optimista sobre el stream de la publicación', async () => {
    const m = montar(store);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    await expect(
      store.append(ctx, pubStreamId(pub.publicationId), 0, [{ type: 'pub.cancelada', payload: { motivo: 'x' }, attribution: attr, occurredAt: now }]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('aislamiento organizacional y migración idempotente', async () => {
    const m = montar(store);
    const ctx = ctxFor();
    const paquete = await sembrarPaquete(m, 'act-blog-0', ctx);
    const pub = await m.publicaciones.publicarCiclo(ctx, publicarCmd(paquete, 'blog', 'simulado'));
    expect((await m.publicaciones.cargar(ctxFor('otra-org'), pub.publicationId)).existe).toBe(false);
    expect(await runMigrations(pool, CADENA)).toEqual([]);
  });
});
