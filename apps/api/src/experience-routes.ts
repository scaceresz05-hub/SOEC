/**
 * Rutas de la experiencia «Comprender el estado» (F1-UI-01).
 * Contexto sintético server-side (sin auth). Ejecuta la cadena real de capacidades.
 * No expone terminología interna ni permite ejecutar acciones sobre el resultado.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import { ExperienciaComprenderEstado } from './experiencia';

export function registerExperienceRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new ExperienciaComprenderEstado(store);

  app.post('/experiencia/comprender-estado/analizar', async (req, reply) => {
    const { executionId } = (req.body ?? {}) as { executionId?: string };
    if (!executionId) return reply.code(400).send({ error: 'MissingExecutionId' });
    const r = await exp.analizar(executionId);
    return reply.code(201).send(r);
  });

  app.get('/experiencia/comprender-estado/historial', async (_req, reply) => {
    return reply.send({ historial: await exp.historial() });
  });

  app.get('/experiencia/comprender-estado/:execId', async (req, reply) => {
    const { execId } = req.params as { execId: string };
    const r = await exp.detalle(execId);
    if (!r.existe) return reply.code(404).send({ error: 'NotFound', executionId: execId });
    return reply.send(r);
  });
}
