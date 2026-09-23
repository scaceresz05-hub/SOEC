/**
 * apps/api · HANDOFF EXTERNO · superficie HTTP.
 *
 * `GET /handoff` responde UNA cosa: la que la empresa tiene que hacer ahora fuera de SOEC. Antes de
 * responder, mira el estado real de los canales y sincroniza las tareas, de modo que nunca se pide algo que
 * el mundo ya resolvió.
 *
 * `POST /handoff/:id/abierta` registra que la persona salió al proveedor (la tarea pasa a esperar al mundo);
 * `POST /handoff/revisar` pasa las tareas por sus verificadores. Ninguna de las dos concede permisos: marcar
 * una tarea no autoriza gasto, ni escritura, ni activación. Eso vive en otras puertas, a propósito.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe } from '../superficie-auth';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { HandoffInvalidoError } from './handoff-tipos';
import { HandoffService, type DepsHandoff } from './handoff-service';
import type { EstadoGoogleParaHandoff } from './handoff-google';

export interface OpcionesHandoffRoutes extends DepsHandoff {
  /**
   * Estado del proveedor Google para esta empresa: ciclo OAuth y cuántas cuentas accesibles se conocen.
   * Se inyecta porque vive en el módulo de adquisición; `null` ⇒ el despliegue no tiene Google configurado.
   */
  readonly estadoGoogle?: (org: string) => Promise<{ readonly estadoProveedor: string | null; readonly cuentasAccesibles: number | null } | null>;
}

export function registerHandoffRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesHandoffRoutes = {}): void {
  const servicio = new HandoffService(pool, opciones);

  const manejarError = (e: unknown, reply: FastifyReply): FastifyReply => {
    if (e instanceof HandoffInvalidoError) return reply.code(400).send({ error: 'HANDOFF_INVALIDO', message: e.message });
    throw e;
  };

  /** Sincroniza los canales con el mundo antes de contestar. Hoy: Google. */
  const sincronizar = async (org: string): Promise<void> => {
    if (opciones.estadoGoogle === undefined) return;
    const estado = await opciones.estadoGoogle(org).catch(() => null);
    if (estado === null) return;
    const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS');
    const entrada: EstadoGoogleParaHandoff = {
      estadoProveedor: estado.estadoProveedor,
      cuentasAccesibles: estado.cuentasAccesibles,
      cuentaEnElSsot: conexion !== null && conexion.estado === 'CONNECTED'
        && String((conexion.configuracion as { customerId?: string }).customerId ?? conexion.externalAccountId ?? '') !== '',
    };
    await servicio.sincronizarGoogle(org, entrada);
  };

  app.get('/handoff', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    try {
      await sincronizar(org);
      return reply.send(await servicio.vista(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  /** La persona pulsó el botón y salió al proveedor: la tarea queda esperando al mundo. */
  app.post('/handoff/:id/abierta', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    const { id } = req.params as { id: string };
    const h = await servicio.marcarEsperandoFuera(org, id);
    if (h === null) return reply.code(404).send({ error: 'TAREA_NO_ENCONTRADA' });
    return reply.send(await servicio.vista(org));
  });

  /** Vuelve a comprobar contra el mundo: cierra lo que ya se cumplió. Nadie «marca como hecho» a mano. */
  app.post('/handoff/revisar', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    try {
      const r = await servicio.verificarPendientes(org);
      await sincronizar(org);
      return reply.send({ ...(await servicio.vista(org)), revisadas: r.revisadas, completadas: r.completadas.length });
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  app.get('/handoff/historial', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    return reply.send({ organizationId: org, tareas: await servicio.historial(org) });
  });
}
