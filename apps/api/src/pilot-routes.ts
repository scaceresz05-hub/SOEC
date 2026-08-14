/**
 * Rutas de Preparación del Piloto (F2-PILOT-01). Preparan y verifican con una
 * organización sintética. El endpoint de activación SIEMPRE devuelve una denegación
 * segura (409) explicando qué autorización estratégica falta. NO existe endpoint capaz
 * de activar producción real, gastar, usar credenciales reales ni saltar la autorización.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { EscenarioEnsayo, Entorno } from '@soec/piloto';
import { PilotExperience } from './pilot-experience';
import { PilotDecisionExperience } from './pilot-decision-experience';
import { contextoDe } from './superficie-auth';
import { BindingDeExperienciaInvalidoError, bindExperienciaReal } from './plataforma';

export function registerPilotRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new PilotExperience(store);

  /**
   * D-2/D-4: la experiencia se construye POR PETICIÓN para la organización AUTENTICADA, tras el
   * binding explícito. Ninguna organización obtiene el expediente de otra, y una organización sin
   * configuración de decisión de piloto recibe una denegación (403), no los datos de SmileFlow.
   */
  const decisionDe = (req: FastifyRequest): PilotDecisionExperience => {
    const ctx = contextoDe(req);
    const binding = bindExperienciaReal(ctx, 'piloto-decision');
    const cfg = binding.negocio.decisionPiloto;
    if (!cfg) {
      throw new BindingDeExperienciaInvalidoError(
        binding.organizationId,
        'piloto-decision',
        'la organización no tiene configuración de decisión de piloto',
      );
    }
    return new PilotDecisionExperience(store, binding.organizationId, cfg);
  };

  // Decisión del primer piloto real — F2-PILOT-DEC-01. La activación real sigue bloqueada:
  // 'activar' devuelve una denegación (409) con lo que falta.
  app.post('/piloto/decision/preparar', async (req, reply) => {
    await decisionDe(req).preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/piloto/decision/estado', async (req, reply) =>
    reply.send(await decisionDe(req).estado()),
  );
  app.post('/piloto/decision/activar', async (req, reply) =>
    reply.code(409).send(await decisionDe(req).intentarActivar()),
  );

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
