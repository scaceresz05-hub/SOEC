/**
 * apps/api · INVESTIGACIÓN Y PLANIFICACIÓN · superficie HTTP.
 *
 * Dentro del gateway vertical: la organización del CONTEXTO es la autoridad. Leer exige contexto; investigar y
 * generar un plan exigen además `business.manage`, porque consumen cuota de la cuenta del negocio.
 *
 * NO EXISTE NINGUNA RUTA QUE PUBLIQUE NADA. Esta superficie sólo consulta, deriva y propone; crear una campaña
 * en Google o Meta no está implementado en esta fase, ni siquiera detrás de un permiso.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { InvestigacionInvalidaError } from './investigacion-tipos';
import { InvestigacionNoPosibleError, InvestigacionService, NegocioSinPerfilError, type DepsInvestigacion } from './investigacion-service';
import { PlanInvalidoError, PlanService, SinInvestigacionError } from './plan-service';
import { correrSondasDeDemanda, leerSondas, type EntradaSondas } from './probe-demanda';

function manejarError(e: unknown, reply: FastifyReply): FastifyReply {
  if (e instanceof InvestigacionInvalidaError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
  if (e instanceof InvestigacionNoPosibleError) return reply.code(409).send({ error: 'INVESTIGACION_NO_POSIBLE', message: e.message });
  if (e instanceof SinInvestigacionError) return reply.code(409).send({ error: 'SIN_INVESTIGACION', message: e.message });
  // Un plan que supera el presupuesto autorizado no se guarda ni se recorta: se rechaza diciendo por qué.
  if (e instanceof PlanInvalidoError) return reply.code(409).send({ error: 'PLAN_INVALID', message: e.message });
  if (e instanceof NegocioSinPerfilError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: e.message });
  throw e;
}

export interface OpcionesInvestigacionRoutes {
  /** Proveedores de la composición: sin ellos, las fuentes se registran como no disponibles (no se simulan). */
  readonly proveedores?: (org: string) => Promise<DepsInvestigacion>;
  readonly refrescar?: () => Promise<void>;
  /**
   * Sondas del planificador de palabras: consultas de LECTURA para diagnosticar de dónde viene un silencio.
   * Sin esta composición la ruta lo dice y no inventa un diagnóstico.
   */
  readonly sondasDeDemanda?: (org: string) => Promise<EntradaSondas | null>;
  readonly log?: (info: Record<string, unknown>) => void;
}

export function registerInvestigacionRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesInvestigacionRoutes = {}): void {
  const datosDe = (req: FastifyRequest): { org: string; actor: string } => {
    const ctx = contextoDe(req);
    return { org: String(ctx.organizationId), actor: String(ctx.actor) };
  };
  const puedeGestionar = (req: FastifyRequest): boolean => permisosDe(req).has('business.manage');
  const servicio = async (org: string): Promise<InvestigacionService> =>
    new InvestigacionService(pool, (await opciones.proveedores?.(org)) ?? {});
  const planes = (): PlanService => new PlanService(pool, {});

  // ── INVESTIGACIÓN: estado actual (no consulta a nadie: sólo lee lo persistido) ──
  app.get('/investigacion', async (req, reply) => {
    const { org } = datosDe(req);
    try {
      return reply.send(await (await servicio(org)).estado(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── INVESTIGAR: reutiliza la anterior si sigue fresca; `forzar` la repite ──
  app.post('/investigacion', async (req, reply) => {
    const { org, actor } = datosDe(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const cuerpo = (req.body ?? {}) as { forzar?: boolean };
    try {
      const svc = await servicio(org);
      return reply.send(await svc.investigar(org, actor, { forzar: cuerpo.forzar === true }));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  /**
   * ── DIAGNÓSTICO DEL PLANIFICADOR DE PALABRAS (sólo lectura) ──
   *
   * Pregunta lo mismo de seis maneras y devuelve qué contestó cada una. No persiste nada, no cambia nada y no
   * concluye más de lo que las propias sondas separan: si todas callan por igual, lo dice.
   */
  app.post('/investigacion/sondas-demanda', async (req, reply) => {
    const { org } = datosDe(req);
    // Consume cuota de la cuenta del negocio, así que exige el mismo permiso que investigar.
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const entrada = await opciones.sondasDeDemanda?.(org);
    if (entrada === null || entrada === undefined) {
      return reply.code(409).send({ error: 'SIN_CUENTA_CONECTADA', message: 'no hay una cuenta de publicidad conectada con la que consultar' });
    }
    const sondas = await correrSondasDeDemanda(entrada);
    const lectura = leerSondas(sondas);
    opciones.log?.({ sondasDemanda: { org, sondas: sondas.map((x) => ({ modo: x.modo, geos: x.geoTargetIds.length, resultado: x.resultado, ideas: x.ideas, codigo: x.codigo })), causa: lectura.causa } });
    return reply.send({ organizationId: org, sondas, lectura });
  });

  // ── PLAN: último plan, sus grupos y el historial ──
  app.get('/plan', async (req, reply) => {
    const { org } = datosDe(req);
    try {
      return reply.send(await planes().estado(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── GENERAR PLAN: versiona; el anterior queda superado, no borrado ──
  app.post('/plan', async (req, reply) => {
    const { org, actor } = datosDe(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await planes().generar(org, actor));
    } catch (e) {
      return manejarError(e, reply);
    }
  });
}
