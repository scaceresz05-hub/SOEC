/**
 * Rutas de la Fábrica Autónoma de Contenido (F2-CONT-01). Contexto sintético
 * server-side. Conducen el ciclo brief → pieza → adaptaciones → validación →
 * revisión → paquete → entrega → ejecución simulada. NO hay endpoint para publicar
 * en real, gastar, ni saltar la autorización del plano operacional.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import { ContentExperience } from './content-experience';

export function registerContentRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new ContentExperience(store);

  app.post('/contenido/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/contenido/estado', async (_req, reply) => reply.send(await exp.estado()));
  app.post('/contenido/preparar-todo', async (_req, reply) =>
    reply.code(201).send(await exp.prepararTodo()),
  );
  app.post('/contenido/actividades/:id/preparar-contenido', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.code(201).send(await exp.prepararActividad(id));
  });
  app.post('/contenido/ejecutar-siguiente', async (_req, reply) =>
    reply.code(201).send(await exp.ejecutarSiguiente()),
  );
}
