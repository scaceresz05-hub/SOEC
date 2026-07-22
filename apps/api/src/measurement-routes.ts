/**
 * Rutas de medición y optimización (F2-MET-01). Conducen el ciclo medir → evaluar →
 * optimizar → replanificar sobre datos sintéticos. NO hay endpoint para gastar,
 * publicar públicamente ni saltar la autorización.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import { MeasurementExperience } from './measurement-experience';

export function registerMeasurementRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new MeasurementExperience(store);

  app.post('/medicion/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/medicion/estado', async (_req, reply) => reply.send(await exp.estado()));
  app.post('/medicion/sincronizar', async (req, reply) => {
    const { escenario } = (req.body ?? {}) as { escenario?: 'alto' | 'bajo' | 'insuficiente' | 'gasto_excedido' };
    return reply.code(201).send(await exp.sincronizarTodo(escenario ?? 'bajo'));
  });
  app.post('/medicion/optimizar', async (_req, reply) => reply.code(201).send(await exp.optimizarTodo()));
}
