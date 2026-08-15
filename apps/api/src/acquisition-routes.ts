/**
 * apps/api · Superficie HTTP del Acquisition Engine — SÓLO LECTURA / SHADOW, tenant-scoped.
 *
 * La organización SIEMPRE se deriva del contexto AUTENTICADO (`contextoDe`), nunca de la URL ni de un
 * header de tenant confiado del cliente. No hay endpoint de escritura, publicación ni creación de
 * campaña. `CERO ≠ NO CONECTADO`: cada canal informa su estado real. 404 si la org no está registrada.
 */
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import { contextoDe } from './superficie-auth';
import { getBusiness } from './plataforma';
import { resumenDe, canalesDe, estrategiaDe, outcomesDe, economiaDe } from './acquisition/acquisition-service';
import { estadoMetaDe } from './acquisition/meta-read-adapter';

export function registerAcquisitionRoutes(app: FastifyInstance, _store?: EventStore): void {
  /** Org del contexto autenticado; lanza 404 ORGANIZATION_NOT_CONFIGURED si no está registrada. */
  const orgDe = (req: Parameters<typeof contextoDe>[0]): string => {
    const org = String(contextoDe(req).organizationId);
    getBusiness(org); // fail-closed: 404 si la org no existe
    return org;
  };

  app.get('/acquisition/summary', async (req, reply) => reply.send(resumenDe(orgDe(req))));
  app.get('/acquisition/channels', async (req, reply) =>
    reply.send({ canales: canalesDe(orgDe(req)), meta: estadoMetaDe(orgDe(req)) }),
  );
  app.get('/acquisition/strategy', async (req, reply) => reply.send(estrategiaDe(orgDe(req))));
  app.get('/acquisition/content', async (req, reply) =>
    // En este bloque no hay contenido preparado: DRAFT_ONLY sin BrandPolicy. No se fabrican filas.
    reply.send({ borradores: [], requierenRevision: [], programados: [], publicados: [], nota: 'Aún no hay contenido preparado.' }),
  );
  app.get('/acquisition/campaigns', async (req, reply) =>
    // Ninguna campaña externa creada; las propuestas shadow se generan bajo demanda futura.
    reply.send({ propuestasShadow: [], requierenAprobacion: [], activas: 'NOT_CONNECTED', externalCampaignsCreated: 0, org: orgDe(req) }),
  );
  app.get('/acquisition/outcomes', async (req, reply) =>
    reply.send({ outcomes: outcomesDe(orgDe(req)), economia: economiaDe(orgDe(req)) }),
  );
}
