/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · superficie HTTP.
 *
 * Dentro del gateway vertical: la organización, el actor y el MODO OPERATIVO vienen del contexto autenticado,
 * nunca del cuerpo de la petición. Todo lo que escribe exige `business.manage`.
 *
 * NO EXISTE NINGUNA RUTA PARA ACTIVAR UNA CAMPAÑA. Ni con permiso, ni con bandera, ni con parámetro: esta fase
 * crea campañas en pausa, y encender una es otra decisión, de otra fase.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, modoOperativoDe, permisosDe } from '../superficie-auth';
import {
  EjecucionBloqueadaError,
  EjecucionInvalidaError,
  EjecucionNoEncontradaError,
} from './ejecucion-tipos';
import { EjecucionService, NegocioSinPerfilError, SinPlanError, type DepsEjecucion } from './ejecucion-service';

function manejarError(e: unknown, reply: FastifyReply): FastifyReply {
  if (e instanceof EjecucionBloqueadaError) {
    return reply.code(409).send({ error: 'EJECUCION_BLOQUEADA', message: e.message, requisitos: e.requisitos });
  }
  if (e instanceof EjecucionInvalidaError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
  if (e instanceof SinPlanError) return reply.code(409).send({ error: 'SIN_PLAN', message: e.message });
  if (e instanceof EjecucionNoEncontradaError) return reply.code(404).send({ error: 'NO_ENCONTRADA', message: e.message });
  if (e instanceof NegocioSinPerfilError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: e.message });
  throw e;
}

export interface OpcionesEjecucionRoutes extends DepsEjecucion {
  readonly refrescar?: () => Promise<void>;
}

export function registerEjecucionRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesEjecucionRoutes = {}): void {
  const servicio = (): EjecucionService => new EjecucionService(pool, opciones);
  const datos = (req: FastifyRequest): { org: string; actor: string; modo: string | null } => {
    const ctx = contextoDe(req);
    return { org: String(ctx.organizationId), actor: String(ctx.actor), modo: modoOperativoDe(req) };
  };
  const puedeGestionar = (req: FastifyRequest): boolean => permisosDe(req).has('business.manage');

  // ── ESTADO: qué se crearía, qué falta y qué se creó ya ──
  app.get('/campana/ejecucion', async (req, reply) => {
    const { org, modo } = datos(req);
    try {
      return reply.send(await servicio().estado(org, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── MATERIAL DE ANUNCIOS: escribirlos y aprobarlos es un acto humano ──
  app.post('/campana/material', async (req, reply) => {
    const { org, actor } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      const cuerpo = (req.body ?? {}) as Parameters<EjecucionService['guardarMaterial']>[2];
      return reply.send(await servicio().guardarMaterial(org, actor, cuerpo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── MEDICIÓN: crear/adoptar la acción de conversión en la plataforma ──
  app.post('/campana/medicion', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await servicio().prepararMedicion(org, actor, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── MEDICIÓN: declararla instalada o verificarla contra la señal observada ──
  app.patch('/campana/medicion', async (req, reply) => {
    const { org, actor } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const cuerpo = (req.body ?? {}) as { eventKey?: string; accion?: 'INSTALADA' | 'VERIFICAR' };
    if (!cuerpo.eventKey || (cuerpo.accion !== 'INSTALADA' && cuerpo.accion !== 'VERIFICAR')) {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'falta la acción o el evento' });
    }
    try {
      return reply.send(await servicio().actualizarMedicion(org, actor, { eventKey: cuerpo.eventKey, accion: cuerpo.accion }));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── PREPARAR: congela el paquete y comprueba los requisitos. No escribe nada externo. ──
  app.post('/campana/ejecucion/preparar', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await servicio().preparar(org, actor, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── AUTORIZAR: la aprobación humana explícita, con su firma ──
  app.post('/campana/ejecucion/:id/autorizar', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const { id } = req.params as { id: string };
    try {
      return reply.send(await servicio().autorizar(org, actor, id, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── EJECUTAR: crea la campaña EN PAUSA. Idempotente: reintentar no duplica. ──
  app.post('/campana/ejecucion/:id/ejecutar', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const { id } = req.params as { id: string };
    try {
      const vista = await servicio().ejecutar(org, actor, id, modo);
      await opciones.refrescar?.();
      return reply.send(vista);
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── RECONCILIAR: comparar con la plataforma y registrar divergencias (no las corrige) ──
  app.post('/campana/ejecucion/:id/reconciliar', async (req, reply) => {
    const { org, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const { id } = req.params as { id: string };
    try {
      return reply.send(await servicio().reconciliar(org, id, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  app.post('/campana/ejecucion/:id/cancelar', async (req, reply) => {
    const { org, actor, modo } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const { id } = req.params as { id: string };
    try {
      return reply.send(await servicio().cancelar(org, actor, id, modo));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── LIBRO DE EJECUCIÓN: qué se hizo, en qué orden y con qué identificador externo ──
  app.get('/campana/ejecucion/:id/libro', async (req, reply) => {
    const { org } = datos(req);
    const { id } = req.params as { id: string };
    try {
      return reply.send({ pasos: await servicio().libro(org, id) });
    } catch (e) {
      return manejarError(e, reply);
    }
  });
}
