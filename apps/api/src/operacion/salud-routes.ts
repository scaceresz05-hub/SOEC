/**
 * apps/api · OPERACIÓN · read model HTTP de la salud del runtime autónomo.
 *
 * Responde «¿esto está funcionando?» sin abrir una terminal ni leer logs: por cada trabajo de fondo, cuándo
 * corrió, cuándo tuvo éxito, cuándo falló y con qué error, y su estado derivado
 * (`OPERATIVO · ATRASADO · FALLANDO · DESHABILITADO · SIN_DATOS`). Incluye además la postura de gobierno de
 * la organización autenticada: modo, kill switch y pausa de seguridad.
 *
 * SÓLO LECTURA y acotado al tenant: se devuelven los trabajos de la organización del contexto autenticado
 * más los del despliegue (los schedulers multi-tenant), nunca los de otra empresa.
 */
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { estadoGobierno } from '../gobierno';
import { PgRepositorioSaludJobs, saludDeJobs, JOBS } from './job-health-pg';

/** Cabecera autoritativa del modo operativo, inyectada por el gateway vertical. */
function modoOperativoDe(req: { headers: Record<string, unknown> }): string | null {
  const v = req.headers['x-operational-mode'];
  return typeof v === 'string' ? v : null;
}

export function registerSaludRoutes(app: FastifyInstance, pool: Pool): void {
  const repo = new PgRepositorioSaludJobs(pool);

  app.get('/operacion/salud', async (req, reply) => {
    const { organizationId } = contextoDe(req); // sin contexto ⇒ 403
    if (!permisosDe(req).has('business.read')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const org = String(organizationId);
    const ahora = new Date().toISOString();
    const jobs = await saludDeJobs(repo, ahora, org);
    // Los trabajos declarados que nunca registraron nada se muestran igualmente: su ausencia ES información.
    const presentes = new Set(jobs.map((j) => j.job));
    const faltantes = JOBS.filter((j) => !presentes.has(j)).map((job) => ({
      job, organizationId: '', lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null,
      lastError: null, nextRunAt: null, enabled: true, status: 'SIN_DATOS' as const,
    }));
    return reply.send({
      organizationId: org,
      at: ahora,
      gobierno: estadoGobierno(org, modoOperativoDe(req), process.env),
      jobs: [...jobs, ...faltantes],
    });
  });
}
