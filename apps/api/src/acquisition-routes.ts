/**
 * apps/api · Superficie HTTP del Acquisition Engine — SÓLO LECTURA / SHADOW, tenant-scoped.
 *
 * La organización SIEMPRE se deriva del contexto AUTENTICADO (`contextoDe`), nunca de la URL ni de un
 * header de tenant confiado del cliente. No hay endpoint de escritura, publicación ni creación de
 * campaña. Los outcomes/economía se leen del SSOT real (WooCommerce/Growth/Ads) por organización;
 * `CERO ≠ NO CONECTADO`. 404 si la org no está registrada.
 */
import type { FastifyInstance } from 'fastify';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { contextoDe } from './superficie-auth';
import { getBusiness } from './plataforma';
import { resumenDe, canalesDe, estrategiaDe, outcomesVivosDe } from './acquisition/acquisition-service';
import { estadoMetaDe } from './acquisition/meta-read-adapter';

export function registerAcquisitionRoutes(app: FastifyInstance, store?: EventStore): void {
  /** Org + contexto de lectura del negocio AUTENTICADO; 404 si la org no está registrada. */
  const scope = (req: Parameters<typeof contextoDe>[0]): { ctx: RequestContext; org: string } => {
    const autenticado = contextoDe(req);
    const org = String(autenticado.organizationId);
    getBusiness(org); // fail-closed: 404 ORGANIZATION_NOT_CONFIGURED si no existe
    const o = OrganizationId(org);
    return {
      ctx: {
        organizationId: o,
        actor: ActorId(String(autenticado.actor)),
        scope: { organizationId: o, permissions: ['events:read'] },
        correlationId: autenticado.correlationId,
      },
      org,
    };
  };

  app.get('/acquisition/summary', async (req, reply) => {
    const { ctx, org } = scope(req);
    return reply.send(await resumenDe(store, ctx, org));
  });
  app.get('/acquisition/channels', async (req, reply) => {
    const { org } = scope(req);
    return reply.send({ canales: canalesDe(org), meta: estadoMetaDe(org) });
  });
  app.get('/acquisition/strategy', async (req, reply) => {
    const { org } = scope(req);
    return reply.send(estrategiaDe(org));
  });
  app.get('/acquisition/content', async (req, reply) => {
    scope(req);
    // En este bloque no hay contenido preparado: DRAFT_ONLY sin BrandPolicy. No se fabrican filas.
    return reply.send({ borradores: [], requierenRevision: [], programados: [], publicados: [], nota: 'Aún no hay contenido preparado.' });
  });
  app.get('/acquisition/campaigns', async (req, reply) => {
    const { org } = scope(req);
    // Ninguna campaña externa creada; Meta no conectado.
    return reply.send({ propuestasShadow: [], requierenAprobacion: [], activas: 'NOT_CONNECTED', externalCampaignsCreated: 0, org });
  });
  app.get('/acquisition/outcomes', async (req, reply) => {
    const { ctx, org } = scope(req);
    const v = await outcomesVivosDe(store, ctx, org);
    return reply.send({ outcomes: v.outcomes, economia: v.economia, atribucion: v.atribucion, revenue: v.revenue });
  });
}
