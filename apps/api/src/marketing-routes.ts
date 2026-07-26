/**
 * Rutas de la experiencia de marketing autónomo (F2-MKT-01). Contexto sintético
 * server-side. Conducen el ciclo plan → autorización → simulación → replanificación.
 * No hay endpoint para publicar en real ni para saltar la autorización.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import { MarketingExperience } from './marketing-experience';

export function registerMarketingRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new MarketingExperience(store);

  app.post('/marketing/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/marketing/estado', async (_req, reply) => reply.send(await exp.estado()));
  app.post('/marketing/ejecutar-siguiente', async (_req, reply) =>
    reply.code(201).send(await exp.ejecutarSiguiente()),
  );
  app.post('/marketing/replanificar', async (req, reply) => {
    const { motivo } = (req.body ?? {}) as { motivo?: string };
    return reply.code(201).send(await exp.replanificar(motivo ?? 'replanificación manual'));
  });
  app.post('/marketing/pausar', async (_req, reply) => {
    await exp.pausar();
    return reply.code(201).send({ ok: true });
  });
  app.post('/marketing/reanudar', async (_req, reply) => {
    await exp.reanudar();
    return reply.code(201).send({ ok: true });
  });
}
