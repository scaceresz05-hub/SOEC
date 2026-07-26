/**
 * Rutas de la experiencia «Evaluación» (F2-DISC-03 · F2-PILOT-00). Ruta estable e
 * independiente del idioma: /experience/{catalogo,evaluacion/*}. Selección gobernada,
 * identidad por evaluación, ciclo de estados. Contexto sintético server-side.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import type { EntradaRespuesta } from '@soec/evaluacion';
import { EvaluacionExperience } from './evaluacion-experience';

function faltan(...v: Array<string | undefined>): boolean {
  return v.some((x) => !x || !x.trim());
}

export function registerEvaluacionRoutes(
  app: FastifyInstance,
  store: EventStore,
  clock: Clock,
): void {
  const exp = new EvaluacionExperience(store, clock);

  app.get('/experience/catalogo', async (_req, reply) => reply.send(exp.catalogo()));

  app.get('/experience/evaluacion/lista', async (req, reply) => {
    const { org, departamento } = (req.query ?? {}) as { org?: string; departamento?: string };
    if (faltan(org, departamento)) return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply.send(await exp.lista(org!, departamento!));
  });

  app.post('/experience/evaluacion/iniciar', async (req, reply) => {
    const b = (req.body ?? {}) as { org?: string; departamento?: string; titulo?: string };
    if (faltan(b.org, b.departamento)) return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply
      .code(201)
      .send(await exp.iniciar(b.org!, b.departamento!, b.titulo?.trim() || null));
  });

  app.get('/experience/evaluacion/estado', async (req, reply) => {
    const { org, departamento, evaluacionId } = (req.query ?? {}) as {
      org?: string;
      departamento?: string;
      evaluacionId?: string;
    };
    if (faltan(org, departamento, evaluacionId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply.send(await exp.estado(org!, departamento!, evaluacionId!));
  });

  app.post('/experience/evaluacion/responder', async (req, reply) => {
    const b = (req.body ?? {}) as {
      org?: string;
      departamento?: string;
      evaluacionId?: string;
      preguntaId?: string;
      entrada?: EntradaRespuesta;
    };
    if (faltan(b.org, b.departamento, b.evaluacionId, b.preguntaId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    if (!b.entrada || typeof b.entrada !== 'object')
      return reply.code(400).send({ error: 'EntradaRequerida' });
    return reply
      .code(201)
      .send(
        await exp.responder(b.org!, b.departamento!, b.evaluacionId!, b.preguntaId!, b.entrada),
      );
  });

  app.post('/experience/evaluacion/generar', async (req, reply) => {
    const b = (req.body ?? {}) as { org?: string; departamento?: string; evaluacionId?: string };
    if (faltan(b.org, b.departamento, b.evaluacionId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply.code(201).send(await exp.generar(b.org!, b.departamento!, b.evaluacionId!));
  });

  app.post('/experience/evaluacion/cerrar', async (req, reply) => {
    const b = (req.body ?? {}) as { org?: string; departamento?: string; evaluacionId?: string };
    if (faltan(b.org, b.departamento, b.evaluacionId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply.code(201).send(await exp.cerrar(b.org!, b.departamento!, b.evaluacionId!));
  });
}
