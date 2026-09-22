/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · superficie HTTP.
 *
 * Dentro del gateway vertical: organización, actor y modo operativo vienen del contexto autenticado. Todo lo
 * que decide o cambia algo exige `business.manage`.
 *
 * Dos rutas merecen una nota:
 *  · `POST /optimizacion/ciclo` corre el ciclo. En modo observación o supervisado NO puede mutar nada: el
 *    gobierno lo impide aunque alguien llame la ruta con mala intención.
 *  · `POST /optimizacion/activar` es la ÚNICA forma de encender una campaña, y exige las ocho condiciones más
 *    la firma de una persona (o un permiso de activación automática declarado explícitamente).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, modoOperativoDe, permisosDe } from '../superficie-auth';
import { OptimizacionInvalidaError, OptimizacionNoEncontradaError, type ModoCiclo } from './optimizacion-tipos';
import { NegocioSinPerfilError, OptimizacionService, type DepsOptimizacion } from './optimizacion-service';
import type { PoliticaAutonomia } from './optimizacion-pg';

function manejarError(e: unknown, reply: FastifyReply): FastifyReply {
  if (e instanceof OptimizacionInvalidaError) return reply.code(409).send({ error: 'OPTIMIZACION_NO_POSIBLE', message: e.message });
  if (e instanceof OptimizacionNoEncontradaError) return reply.code(404).send({ error: 'NO_ENCONTRADA', message: e.message });
  if (e instanceof NegocioSinPerfilError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: e.message });
  throw e;
}

export interface OpcionesOptimizacionRoutes extends DepsOptimizacion {
  readonly refrescar?: () => Promise<void>;
}

export function registerOptimizacionRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesOptimizacionRoutes = {}): void {
  const servicio = (): OptimizacionService => new OptimizacionService(pool, opciones);
  const datos = (req: FastifyRequest): { org: string; actor: string; modo: string | null } => {
    const ctx = contextoDe(req);
    return { org: String(ctx.organizationId), actor: String(ctx.actor), modo: modoOperativoDe(req) };
  };
  const puedeGestionar = (req: FastifyRequest): boolean => permisosDe(req).has('business.manage');

  // ── ESTADO: qué observa SOEC, qué decidió, qué espera aprobación y qué resultó ──
  app.get('/optimizacion', async (req, reply) => {
    const { org, modo } = datos(req);
    try {
      return reply.send(await servicio().estado(org, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── CICLO: observar → evaluar → decidir → gobernar → (ejecutar) → verificar ──
  app.post('/optimizacion/ciclo', async (req, reply) => {
    const { org, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const cuerpo = (req.body ?? {}) as { modo?: ModoCiclo; ventanaDias?: number };
    // Se puede pedir explícitamente el modo SOMBRA (observar y registrar qué haría). Nunca al revés: nadie
    // puede pedir «autónomo» desde una petición HTTP si su empresa no está en ese modo.
    const modoCiclo: ModoCiclo | undefined = cuerpo.modo === 'SHADOW' ? 'SHADOW' : undefined;
    try {
      const vista = await servicio().correrCiclo(org, {
        ...(modoCiclo ? { modo: modoCiclo } : {}),
        modoOperativo: modo,
        ...(cuerpo.ventanaDias ? { ventanaDias: Number(cuerpo.ventanaDias) } : {}),
      });
      await opciones.refrescar?.();
      return reply.send(vista);
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── LÍMITES DE AUTONOMÍA: qué puede hacer SOEC sola (el cuánto vive en el mandato) ──
  app.patch('/optimizacion/politica', async (req, reply) => {
    const { org, actor } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await servicio().fijarPolitica(org, actor, (req.body ?? {}) as Partial<PoliticaAutonomia>));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── COLA DE APROBACIÓN: aprobar, rechazar o ajustar una acción propuesta ──
  app.post('/optimizacion/pendientes/:id', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const { id } = req.params as { id: string };
    const cuerpo = (req.body ?? {}) as { decision?: 'APROBAR' | 'RECHAZAR' | 'AJUSTAR'; nota?: string; ajuste?: Record<string, unknown> };
    if (cuerpo.decision !== 'APROBAR' && cuerpo.decision !== 'RECHAZAR' && cuerpo.decision !== 'AJUSTAR') {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'falta decidir: aprobar, rechazar o ajustar' });
    }
    try {
      return reply.send(await servicio().resolverPendiente(org, actor, id, {
        decision: cuerpo.decision,
        ...(cuerpo.nota ? { nota: cuerpo.nota } : {}),
        ...(cuerpo.ajuste ? { ajuste: cuerpo.ajuste } : {}),
      }, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── ACTIVAR: la única ruta que enciende una campaña. Ocho condiciones + firma humana. ──
  app.post('/optimizacion/activar', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      const vista = await servicio().activarCampana(org, actor, modo);
      await opciones.refrescar?.();
      return reply.send(vista);
    } catch (e) {
      return manejarError(e, reply);
    }
  });
}
