/**
 * Rutas del Centro de Control (F2-CTRL-01). Gobierno y supervisión del departamento
 * autónomo: resumen, actividad, decisiones (aprobar/denegar), pausa/reanudación,
 * alertas, auditoría y ciclo sintético. NO hay endpoint para publicar en real, gastar,
 * habilitar el modo real ni saltar la autorización.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { Alcance, Rol } from '@soec/control';
import { ControlExperience } from './control-experience';

export function registerControlRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new ControlExperience(store);

  app.post('/control/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/control/resumen', async (_req, reply) => reply.send(await exp.resumen()));
  app.get('/control/actividad', async (_req, reply) => reply.send({ entradas: await exp.actividad() }));
  app.get('/control/decisiones', async (_req, reply) => reply.send({ decisiones: await exp.decisionesPendientes() }));
  app.get('/control/alertas', async (_req, reply) => reply.send({ alertas: await exp.alertas() }));
  app.get('/control/auditoria/:canal', async (req, reply) => reply.send(await exp.auditoria((req.params as { canal: string }).canal)));

  app.post('/control/simular', async (req, reply) => {
    const { escenario } = (req.body ?? {}) as { escenario?: 'bajo' | 'alto' | 'insuficiente' | 'gasto_excedido' };
    return reply.code(201).send(await exp.simular(escenario ?? 'bajo'));
  });
  app.post('/control/pausar', async (req, reply) => {
    const b = (req.body ?? {}) as { tipo?: Alcance['tipo']; valor?: string; motivo?: string; actor?: string };
    return reply.code(201).send(await exp.pausar(b.tipo ?? 'departamento', b.valor ?? '*', b.motivo ?? 'pausa del propietario', b.actor ?? 'propietario'));
  });
  app.post('/control/reanudar', async (req, reply) => {
    const b = (req.body ?? {}) as { tipo?: Alcance['tipo']; valor?: string; actor?: string };
    return reply.code(201).send(await exp.reanudar(b.tipo ?? 'departamento', b.valor ?? '*', b.actor ?? 'propietario'));
  });
  app.post('/control/decisiones/:id/resolver', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { estado?: 'aprobada' | 'denegada' | 'pospuesta'; rol?: Rol; actor?: string; comentario?: string };
    return reply.code(201).send(await exp.resolverDecision(id, b.estado ?? 'denegada', b.rol ?? 'propietario', b.actor ?? 'propietario', b.comentario ?? ''));
  });
}
