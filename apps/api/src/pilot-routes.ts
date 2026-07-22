/**
 * Rutas de Preparación del Piloto (F2-PILOT-01). Preparan y verifican con una
 * organización sintética. El endpoint de activación SIEMPRE devuelve una denegación
 * segura (409) explicando qué autorización estratégica falta. NO existe endpoint capaz
 * de activar producción real, gastar, usar credenciales reales ni saltar la autorización.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { EscenarioEnsayo, Entorno } from '@soec/piloto';
import { PilotExperience } from './pilot-experience';

export function registerPilotRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new PilotExperience(store);

  app.post('/piloto/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/piloto/estado', async (_req, reply) => reply.send(await exp.estado()));
  app.get('/piloto/readiness', async (req, reply) => {
    const { entorno } = req.query as { entorno?: Entorno };
    return reply.send(await exp.readiness(entorno ?? 'sandbox'));
  });
  app.post('/piloto/ensayar', async (req, reply) => {
    const { escenario } = (req.body ?? {}) as { escenario?: EscenarioEnsayo };
    return reply.code(201).send(await exp.ensayar(escenario ?? 'exitoso'));
  });
  app.post('/piloto/activar', async (req, reply) => {
    const { entorno } = (req.body ?? {}) as { entorno?: Entorno };
    const r = await exp.intentarActivacion(entorno ?? 'real_preparado');
    // La activación real permanece bloqueada: 409 con la denegación explicable.
    return reply.code(409).send(r);
  });
}
