/**
 * apps/api · HANDOFF EXTERNO · superficie HTTP.
 *
 * UNA REGLA POR ENCIMA DE TODO: **los `GET` no escriben**. `GET /handoff` devuelve la tarea que ya está
 * abierta y `GET /handoff/historial` devuelve lo que pasó; ninguno abre tareas, ninguno las vence y ninguno
 * audita. Antes no era así —leer la pantalla creaba la tarea—, y eso tenía dos costes que no se ven hasta que
 * duelen: mirar cambiaba lo mirado, así que ninguna verificación era de fiar; y la auditoría se llenaba de
 * filas que nadie decidió crear, con lo que dejaba de poder responder «¿quién hizo esto y cuándo?».
 *
 * La sincronización vive donde se la puede ver: `POST /handoff/sync`. Mira el estado real del canal, cierra lo
 * que el mundo ya resolvió, recalcula qué falta y abre la tarea siguiente. Es idempotente y va por
 * organización, así que puede llamarla una persona («ya lo hice, compruébalo») o, cuando llegue la Fase I.4,
 * un scheduler. `POST /handoff/revisar` es el mismo trabajo con el nombre que usa la pantalla.
 *
 * Ninguna de estas rutas concede permisos: abrir, cerrar o marcar una tarea no autoriza gasto, ni escritura,
 * ni activación. Eso vive en otras puertas, a propósito.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, modoOperativoDe } from '../superficie-auth';
import { OnboardingService } from '../onboarding/onboarding-service';
import { HandoffInvalidoError } from './handoff-tipos';
import { HandoffService, type DepsHandoff } from './handoff-service';
import { depsDeHandoff } from './composicion';

export interface OpcionesHandoffRoutes extends DepsHandoff {
  /**
   * Estado del proveedor Google para esta empresa: ciclo OAuth y cuántas cuentas accesibles se conocen.
   * Se inyecta porque vive en el módulo de adquisición; `null` ⇒ el despliegue no tiene Google configurado.
   */
  readonly estadoGoogle?: (org: string) => Promise<{ readonly estadoProveedor: string | null; readonly cuentasAccesibles: number | null } | null>;
}

export function registerHandoffRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesHandoffRoutes = {}): void {
  // La misma fábrica que usa el scheduler de la Fase I.4: reanudar por un clic y reanudar por un tick
  // comparten lector, verificadores y derivación. Un solo camino que mantener honesto.
  const deps = (extra: Partial<DepsHandoff> = {}): DepsHandoff => depsDeHandoff(pool, { ...opciones, ...extra });

  /**
   * Servicio para las rutas de lectura. Se construye SIN verificadores y sin lector del proveedor: aunque
   * alguien añadiera mañana una llamada a sincronizar en un `GET`, no tendría con qué escribir. La invariante
   * no depende de que nadie se equivoque.
   */
  const soloLectura = new HandoffService(pool, { ahora: opciones.ahora, verificadores: [] });

  const manejarError = (e: unknown, reply: FastifyReply): FastifyReply => {
    if (e instanceof HandoffInvalidoError) return reply.code(400).send({ error: 'HANDOFF_INVALIDO', message: e.message });
    throw e;
  };

  /** Lo que la empresa tiene pendiente AHORA. Lectura pura: lo que hay, no lo que habría que abrir. */
  app.get('/handoff', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    try {
      return reply.send(await soloLectura.vista(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  app.get('/handoff/historial', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    return reply.send({ organizationId: org, tareas: await soloLectura.historial(org) });
  });

  /** La persona pulsó el botón y salió al proveedor: la tarea queda esperando al mundo. */
  app.post('/handoff/:id/abierta', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    const { id } = req.params as { id: string };
    const h = await new HandoffService(pool, deps()).marcarEsperandoFuera(org, id);
    if (h === null) return reply.code(404).send({ error: 'TAREA_NO_ENCONTRADA' });
    return reply.send(await soloLectura.vista(org));
  });

  /**
   * SINCRONIZAR: mira el mundo, cierra lo cumplido, recalcula qué falta y abre la tarea siguiente. Es la única
   * superficie que escribe tareas, y por eso es un POST: quien la llama sabe que está cambiando algo.
   * Idempotente y por organización; repetirla no duplica filas ni auditoría.
   */
  const sincronizar = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const org = String(contextoDe(req).organizationId);
    // La preparación se recalcula con el modo que dice el gateway; sin cabecera, el más conservador.
    const modoOperativo = modoOperativoDe(req) ?? 'PILOT';
    const servicio = new HandoffService(pool, deps({
      recalcularPreparacion: opciones.recalcularPreparacion
        ?? (async (o: string) => new OnboardingService(pool, { leerModo: async () => modoOperativo }).readiness(o)),
    }));
    try {
      const r = await servicio.reanudar(org);
      return reply.send({
        organizationId: org, tarea: r.siguiente, pendientes: r.pendientes,
        revisadas: r.revisadas, completadas: r.completadas.length,
        vencidas: r.vencidas, preparacionRecalculada: r.preparacionRecalculada,
      });
    } catch (e) {
      return manejarError(e, reply);
    }
  };

  app.post('/handoff/sync', sincronizar);
  /**
   * El mismo trabajo con el nombre que usa la pantalla: «ya lo hice, compruébalo». Existen los dos porque
   * nombran dos intenciones distintas —una persona comprobando lo suyo, y el sistema poniéndose al día— y
   * porque quitar este alias rompería al cliente ya desplegado sin ganar nada.
   */
  app.post('/handoff/revisar', sincronizar);
}
