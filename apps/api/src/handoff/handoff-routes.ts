/**
 * apps/api · HANDOFF EXTERNO · superficie HTTP.
 *
 * `GET /handoff` responde UNA cosa: la que la empresa tiene que hacer ahora fuera de SOEC. Antes de
 * responder, mira el estado real de los canales y sincroniza las tareas, de modo que nunca se pide algo que
 * el mundo ya resolvió.
 *
 * `POST /handoff/:id/abierta` registra que la persona salió al proveedor (la tarea pasa a esperar al mundo);
 * `POST /handoff/revisar` REANUDA: verifica contra el mundo, cierra lo que ya está hecho, recalcula qué falta
 * ahora y abre la tarea siguiente si corresponde. Ninguna de las dos concede permisos: marcar o cerrar una
 * tarea no autoriza gasto, ni escritura, ni activación. Eso vive en otras puertas, a propósito.
 *
 * Un solo lector del estado del proveedor alimenta las dos mitades —la que abre tareas y la que las cierra—.
 * Si fueran dos, acabarían discrepando, y la persona lo notaría antes que nosotros.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, modoOperativoDe } from '../superficie-auth';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { OnboardingService } from '../onboarding/onboarding-service';
import { HandoffInvalidoError } from './handoff-tipos';
import { HandoffService, type DepsHandoff } from './handoff-service';
import { verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from './handoff-verificadores';
import type { EstadoGoogleParaHandoff } from './handoff-google';

export interface OpcionesHandoffRoutes extends DepsHandoff {
  /**
   * Estado del proveedor Google para esta empresa: ciclo OAuth y cuántas cuentas accesibles se conocen.
   * Se inyecta porque vive en el módulo de adquisición; `null` ⇒ el despliegue no tiene Google configurado.
   */
  readonly estadoGoogle?: (org: string) => Promise<{ readonly estadoProveedor: string | null; readonly cuentasAccesibles: number | null } | null>;
}

export function registerHandoffRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesHandoffRoutes = {}): void {
  /**
   * Estado real del canal de Google, completado con lo que dice el SSOT operativo. Es el único lector: lo usan
   * la sincronización y los verificadores.
   */
  const leerEstadoGoogle = async (org: string): Promise<EstadoGoogleParaHandoff | null> => {
    if (opciones.estadoGoogle === undefined) return null;
    const estado = await opciones.estadoGoogle(org).catch(() => null);
    if (estado === null) return null;
    const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS');
    return {
      estadoProveedor: estado.estadoProveedor,
      cuentasAccesibles: estado.cuentasAccesibles,
      cuentaEnElSsot: conexion !== null && conexion.estado === 'CONNECTED'
        && String((conexion.configuracion as { customerId?: string }).customerId ?? conexion.externalAccountId ?? '') !== '',
    };
  };

  const servicio = new HandoffService(pool, {
    ...opciones,
    leerEstadoGoogle: opciones.leerEstadoGoogle ?? leerEstadoGoogle,
    // Los verificadores de Google se construyen sobre el mismo lector; los tipos que todavía no sabemos
    // observar quedan con su adaptador pendiente explícito, que nunca cierra nada.
    verificadores: opciones.verificadores ?? [...verificadoresDeGoogle(leerEstadoGoogle), ...VERIFICADORES_PENDIENTES],
  });

  const manejarError = (e: unknown, reply: FastifyReply): FastifyReply => {
    if (e instanceof HandoffInvalidoError) return reply.code(400).send({ error: 'HANDOFF_INVALIDO', message: e.message });
    throw e;
  };

  /** Sincroniza los canales con el mundo antes de contestar. Hoy: Google. */
  const sincronizar = async (org: string): Promise<void> => {
    const estado = await leerEstadoGoogle(org);
    if (estado === null) return;
    await servicio.sincronizarGoogle(org, estado);
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

  /**
   * Vuelve a comprobar contra el mundo y reanuda: cierra lo que ya se cumplió, recalcula qué falta y deja
   * abierta la tarea siguiente. Nadie «marca como hecho» a mano.
   */
  app.post('/handoff/revisar', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    // La preparación se recalcula con el modo que dice el gateway; sin cabecera, el más conservador.
    const modoOperativo = modoOperativoDe(req) ?? 'PILOT';
    const conRecalculo = new HandoffService(pool, {
      ...opciones,
      leerEstadoGoogle: opciones.leerEstadoGoogle ?? leerEstadoGoogle,
      verificadores: opciones.verificadores ?? [...verificadoresDeGoogle(leerEstadoGoogle), ...VERIFICADORES_PENDIENTES],
      recalcularPreparacion: opciones.recalcularPreparacion
        ?? (async (o: string) => new OnboardingService(pool, { leerModo: async () => modoOperativo }).readiness(o)),
    });
    try {
      const r = await conRecalculo.reanudar(org);
      return reply.send({
        organizationId: org, tarea: r.siguiente, pendientes: r.pendientes,
        revisadas: r.revisadas, completadas: r.completadas.length, preparacionRecalculada: r.preparacionRecalculada,
      });
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  app.get('/handoff/historial', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    return reply.send({ organizationId: org, tareas: await servicio.historial(org) });
  });
}
