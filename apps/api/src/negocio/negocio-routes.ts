/**
 * apps/api · NEGOCIO COMO DATO · superficie HTTP.
 *
 * Es la MISMA API que usa la interfaz «+ Nueva empresa»: crear, leer, editar y listar empresas sin escribir
 * una línea de código ni desplegar.
 *
 * AUTORIDAD: crear y listar dependen de la SESIÓN (un usuario crea empresas y ve las suyas); leer y editar
 * una empresa concreta dependen del CONTEXTO DE ORGANIZACIÓN que el gateway resolvió contra la membresía.
 * La organización de la URL nunca es autoridad.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { IdentityService } from '@soec/identity';
import { requireUser } from '../auth-context';
import { contextoDe, exigirOrganizacion, permisosDe } from '../superficie-auth';
import { NegocioDuplicadoError, NegocioInvalidoError, NegocioNoEncontradoError, NegocioService, type EntradaNuevoNegocio } from './negocio-service';
import type { CambiosPerfil } from './negocio-pg';

/**
 * Crear y listar dependen SÓLO de la sesión (todavía no hay organización activa cuando alguien da de alta su
 * primera empresa). Leer y editar exigen además el contexto de organización del gateway.
 */
export function registerNegocioRoutes(app: FastifyInstance, pool: Pool, identity: IdentityService): void {
  const svc = new NegocioService(pool);

  const usuario = async (req: FastifyRequest): Promise<{ id: string } | null> => {
    try {
      return await requireUser(identity, req);
    } catch {
      return null; // sin sesión válida ⇒ 401 explícito en la ruta
    }
  };

  const manejarError = (e: unknown, reply: FastifyReply): FastifyReply => {
    if (e instanceof NegocioInvalidoError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
    if (e instanceof NegocioDuplicadoError) return reply.code(409).send({ error: 'CONFLICTO', message: e.message });
    if (e instanceof NegocioNoEncontradoError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO' });
    throw e;
  };

  // ── CREAR: una transacción crea organización + membresía OWNER + perfil + gobierno + auditoría ──
  app.post('/negocios', async (req, reply) => {
    const u = await usuario(req);
    if (u === null) return reply.code(401).send({ error: 'SIN_SESION' });
    try {
      const negocio = await svc.crear(u.id, (req.body ?? {}) as EntradaNuevoNegocio);
      return reply.code(201).send(negocio);
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── LISTAR: sólo las empresas del usuario autenticado (por membresía) ──
  app.get('/negocios', async (req, reply) => {
    const u = await usuario(req);
    if (u === null) return reply.code(401).send({ error: 'SIN_SESION' });
    return reply.send({ negocios: await svc.listarDeUsuario(u.id), filtradoPorMembresia: true });
  });

}

/**
 * Superficie POR TENANT: se registra DENTRO del gateway vertical, que ya validó sesión y membresía e inyectó
 * el contexto. La organización de la URL debe coincidir con ese contexto.
 */
export function registerNegocioTenantRoutes(app: FastifyInstance, pool: Pool): void {
  const svc = new NegocioService(pool);
  const manejarError = (e: unknown, reply: FastifyReply): FastifyReply => {
    if (e instanceof NegocioInvalidoError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
    if (e instanceof NegocioNoEncontradoError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO' });
    throw e;
  };

  // ── LEER: la organización de la URL debe ser la del contexto autenticado ──
  app.get('/negocios/:org', async (req, reply) => {
    const { org } = req.params as { org: string };
    contextoDe(req); // sin contexto ⇒ 403
    exigirOrganizacion(req, org);
    try {
      return reply.send(await svc.leer(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── EDITAR: exige permiso de gestión del negocio, además del contexto correcto ──
  app.patch('/negocios/:org', async (req, reply) => {
    const { org } = req.params as { org: string };
    const ctx = contextoDe(req);
    exigirOrganizacion(req, org);
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await svc.actualizar(org, String(ctx.actor), (req.body ?? {}) as CambiosPerfil));
    } catch (e) {
      return manejarError(e, reply);
    }
  });
}
