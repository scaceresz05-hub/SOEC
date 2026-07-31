/**
 * Rutas de la experiencia «Director Autónomo» (cableado del núcleo A–J al runtime).
 * Ruta estable e independiente del idioma: /experience/director-autonomo/*.
 * Acotada por organización. La ejecución es SIMULADA; no hay efectos externos reales.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { DirectorAutonomoExperience } from './director-autonomo-experience';

function falta(v: string | undefined): boolean {
  return !v || !v.trim();
}

export function registerDirectorAutonomoRoutes(app: FastifyInstance, store: EventStore, clock: Clock): void {
  const exp = new DirectorAutonomoExperience(store, clock);

  app.get('/experience/director-autonomo/estado', async (req, reply) => {
    const { org } = (req.query ?? {}) as { org?: string };
    if (falta(org)) return reply.code(400).send({ error: 'OrganizacionRequerida' });
    return reply.send(await exp.estado(org!));
  });

  app.post('/experience/director-autonomo/ejecutar-ciclo', async (req, reply) => {
    const { org } = (req.body ?? {}) as { org?: string };
    if (falta(org)) return reply.code(400).send({ error: 'OrganizacionRequerida' });
    return reply.code(201).send(await exp.ejecutarCiclo(org!));
  });

  app.post('/experience/director-autonomo/pausar', async (req, reply) => {
    const b = (req.body ?? {}) as { org?: string; motivo?: string };
    if (falta(b.org)) return reply.code(400).send({ error: 'OrganizacionRequerida' });
    return reply.code(201).send(await exp.pausar(b.org!, b.motivo ?? ''));
  });

  app.post('/experience/director-autonomo/reanudar', async (req, reply) => {
    const b = (req.body ?? {}) as { org?: string; actorHumano?: string; motivo?: string };
    if (falta(b.org)) return reply.code(400).send({ error: 'OrganizacionRequerida' });
    if (falta(b.actorHumano)) return reply.code(400).send({ error: 'ActorHumanoRequerido' });
    return reply.code(201).send(await exp.reanudar(b.org!, b.actorHumano!, b.motivo ?? ''));
  });
}
