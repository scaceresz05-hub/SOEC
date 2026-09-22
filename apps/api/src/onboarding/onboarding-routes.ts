/**
 * apps/api · ONBOARDING INTELIGENTE · superficie HTTP.
 *
 * Dentro del gateway vertical: la organización del CONTEXTO es la autoridad. Leer exige contexto; responder,
 * completar y reabrir exigen además `business.manage`.
 *
 * El cambio de MODO OPERATIVO no se hace aquí a mano: se delega en la vía gobernada de identidad
 * (`IdentityService.cambiarModoOperativo`), que tiene su propio permiso, su política y su auditoría. Si el
 * modo pedido no puede activarse, se devuelve el motivo en lugar de fingir que se aplicó.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { IdentityService } from '@soec/identity';
import { requireOrgContext } from '../auth-context';
import { contextoDe, permisosDe } from '../superficie-auth';
import { OnboardingInvalidoError } from './onboarding-tipos';
import { NegocioSinPerfilError, OnboardingService, type DepsOnboarding, type EntradaRespuestas } from './onboarding-service';

function manejarError(e: unknown, reply: FastifyReply): FastifyReply {
  if (e instanceof OnboardingInvalidoError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
  if (e instanceof NegocioSinPerfilError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: e.message });
  throw e;
}

export interface OpcionesOnboardingRoutes {
  readonly refrescar?: () => Promise<void>;
  /** Identidad: habilita aplicar el modo operativo por su vía gobernada. */
  readonly identity?: IdentityService;
  readonly inspeccion?: DepsOnboarding['inspeccion'];
}

export function registerOnboardingRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesOnboardingRoutes = {}): void {
  const datosDe = (req: FastifyRequest): { org: string; actor: string } => {
    const ctx = contextoDe(req);
    return { org: String(ctx.organizationId), actor: String(ctx.actor) };
  };

  /**
   * Servicio por petición: el modo operativo se lee y se aplica con la sesión de QUIEN pide, nunca con una
   * identidad de sistema. Sin identidad disponible, la preferencia se registra y se explica.
   */
  const servicio = (req: FastifyRequest, org: string): OnboardingService => {
    const identity = opciones.identity;
    const deps: DepsOnboarding = {
      ...(opciones.refrescar ? { refrescar: opciones.refrescar } : {}),
      ...(opciones.inspeccion ? { inspeccion: opciones.inspeccion } : {}),
      ...(identity
        ? {
            leerModo: async (): Promise<string> => {
              try {
                const ctx = await requireOrgContext(identity, req, org);
                return ctx.organization.operationalMode;
              } catch {
                return 'PILOT'; // sin contexto resoluble se asume el modo más conservador
              }
            },
            aplicarModo: async (modo: string): Promise<{ ok: boolean; motivo: string }> => {
              try {
                const ctx = await requireOrgContext(identity, req, org);
                const orgActualizada = await identity.cambiarModoOperativo(ctx, modo);
                return { ok: true, motivo: `modo aplicado: ${orgActualizada.operationalMode}` };
              } catch (e) {
                return { ok: false, motivo: e instanceof Error ? e.message : 'no se pudo aplicar el modo' };
              }
            },
          }
        : {}),
    };
    return new OnboardingService(pool, deps);
  };

  // ── LEER: estado del asistente, preguntas que tocan, readiness y resumen ──
  app.get('/onboarding', async (req, reply) => {
    const { org } = datosDe(req);
    try {
      return reply.send(await servicio(req, org).leer(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── READINESS solo: lo consume también el panel del negocio ──
  app.get('/onboarding/readiness', async (req, reply) => {
    const { org } = datosDe(req);
    try {
      return reply.send(await servicio(req, org).readiness(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── RESPONDER un paso: guarda, traduce a los datos del negocio y recalcula ──
  app.patch('/onboarding', async (req, reply) => {
    const { org, actor } = datosDe(req);
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await servicio(req, org).responder(org, actor, (req.body ?? {}) as EntradaRespuestas));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── REVISAR EL SITIO declarado: lectura única de su portada; lo observado queda como propuesta ──
  app.post('/onboarding/sitio', async (req, reply) => {
    const { org, actor } = datosDe(req);
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const cuerpo = (req.body ?? {}) as { url?: string };
    try {
      return reply.send(await servicio(req, org).inspeccionarSitioDeclarado(org, actor, cuerpo.url));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── COMPLETAR: marca terminado o dice qué falta. No cambia ningún permiso ──
  app.post('/onboarding/completar', async (req, reply) => {
    const { org, actor } = datosDe(req);
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await servicio(req, org).completar(org, actor));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── REABRIR: volver a revisar o corregir. Nada se borra ──
  app.post('/onboarding/reabrir', async (req, reply) => {
    const { org, actor } = datosDe(req);
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await servicio(req, org).reabrir(org, actor));
    } catch (e) {
      return manejarError(e, reply);
    }
  });
}
