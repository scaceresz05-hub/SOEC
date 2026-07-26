/**
 * Rutas de la experiencia «Director Workspace» (F2-DISC-02/03 · F2-PILOT-00).
 * Ruta estable e independiente del idioma: /experience/director-workspace/*.
 * Gobierna una evaluación identificada (org + departamento + evaluacionId).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import type { CategoriaJustificacion, ResultadoDecision } from '@soec/decision';
import { DirectorWorkspaceExperience } from './director-workspace-experience';

function faltan(...v: Array<string | undefined>): boolean {
  return v.some((x) => !x || !x.trim());
}

export function registerDirectorWorkspaceRoutes(
  app: FastifyInstance,
  store: EventStore,
  clock: Clock,
): void {
  const exp = new DirectorWorkspaceExperience(store, clock);

  app.get('/experience/director-workspace/estado', async (req, reply) => {
    const { org, departamento, evaluacionId } = (req.query ?? {}) as {
      org?: string;
      departamento?: string;
      evaluacionId?: string;
    };
    if (faltan(org, departamento, evaluacionId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply.send(await exp.estado(org!, departamento!, evaluacionId!));
  });

  app.post('/experience/director-workspace/decidir', async (req, reply) => {
    const b = (req.body ?? {}) as {
      org?: string;
      departamento?: string;
      evaluacionId?: string;
      decisionId?: string;
      resultado?: ResultadoDecision;
      objetivoId?: string | null;
      justificacion?: { texto?: string; categoria?: CategoriaJustificacion };
    };
    if (faltan(b.org, b.departamento, b.evaluacionId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    if (b.resultado !== 'ACEPTADO' && b.resultado !== 'RECHAZADO')
      return reply.code(400).send({ error: 'ResultadoInvalido' });
    if (!b.justificacion?.texto || !b.justificacion.categoria)
      return reply.code(400).send({ error: 'JustificacionRequerida' });
    const r = await exp.decidir({
      organizationId: b.org!,
      departamentoId: b.departamento!,
      evaluacionId: b.evaluacionId!,
      decisionId: b.decisionId || randomUUID(),
      resultado: b.resultado,
      objetivoId: b.objetivoId ?? null,
      justificacion: { texto: b.justificacion.texto, categoria: b.justificacion.categoria },
    });
    return reply.code(201).send(r);
  });

  app.post('/experience/director-workspace/revocar', async (req, reply) => {
    const b = (req.body ?? {}) as {
      org?: string;
      departamento?: string;
      evaluacionId?: string;
      decisionId?: string;
      motivo?: string;
    };
    if (faltan(b.org, b.departamento, b.evaluacionId, b.decisionId))
      return reply.code(400).send({ error: 'SeleccionRequerida' });
    return reply
      .code(201)
      .send(
        await exp.revocar(
          b.org!,
          b.departamento!,
          b.evaluacionId!,
          b.decisionId!,
          b.motivo || 'revocada por el Director',
        ),
      );
  });
}
