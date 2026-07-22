/**
 * Rutas del plano de canales (F2-CHAN-01). Conducen la publicación controlada contra
 * un proveedor emulado/simulado. NO hay endpoint para publicar públicamente en real,
 * gastar ni saltar la autorización del plano operacional.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { ModoPublicacion, WebhookEntrante } from '@soec/canales';
import { ChannelExperience } from './channel-experience';

export function registerChannelRoutes(app: FastifyInstance, store: EventStore): void {
  const emuUrl = process.env.EMU_URL; // si está presente, el modo sandbox usa el proveedor emulado
  const exp = new ChannelExperience(store, emuUrl);

  app.post('/canales/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/canales/estado', async (_req, reply) => reply.send(await exp.estado()));
  app.post('/canales/publicar-todo', async (req, reply) => {
    const { modo } = (req.body ?? {}) as { modo?: ModoPublicacion };
    return reply.code(201).send(await exp.publicarTodo(modo));
  });
  app.post('/canales/actividades/:id/publicar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { canal, modo } = (req.body ?? {}) as { canal?: string; modo?: ModoPublicacion };
    if (!canal) return reply.code(422).send({ error: 'CanalRequerido' });
    return reply.code(201).send(await exp.publicar(id, canal, modo));
  });
  app.post('/canales/actividades/:id/retirar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { canal } = (req.body ?? {}) as { canal?: string };
    if (!canal) return reply.code(422).send({ error: 'CanalRequerido' });
    return reply.code(201).send(await exp.retirar(id, canal));
  });
  app.post('/canales/webhook', async (req, reply) => {
    const wh = req.body as WebhookEntrante;
    return reply.code(201).send(await exp.webhook(wh));
  });
}
