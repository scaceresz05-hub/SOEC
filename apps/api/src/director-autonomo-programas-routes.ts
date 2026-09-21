/**
 * Rutas de configuración de programas por negocio (aditivas al Director Autónomo).
 * Base: /experience/director-autonomo/organizaciones/*. Acotadas por organización; validan
 * entrada; los errores de dominio se mapean a 4xx en el handler central. Ejecución SIMULADA.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { EventStore } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { DirectorAutonomoProgramasExperience } from './director-autonomo-programas-experience';
import { exigirOrganizacion } from './superficie-auth';

function falta(v: string | undefined): boolean {
  return !v || !v.trim();
}
const BASE = '/experience/director-autonomo/organizaciones';

export function registerDirectorAutonomoProgramasRoutes(app: FastifyInstance, store: EventStore, clock: Clock, opts: { readonly demoSinAuth?: boolean } = {}): void {
  const exp = new DirectorAutonomoProgramasExperience(store, clock);
  /** La organización de la URL/cuerpo NO es autoridad: debe coincidir con la del contexto autenticado. */
  const mismoTenant = (req: Parameters<typeof exigirOrganizacion>[0], org: string): void => exigirOrganizacion(req, org, opts);

  // ── Negocio / organizaciones ────────────────────────────────────────────────────────────────
  // Listado: sólo la organización del contexto autenticado (el registro es un stream compartido entre tenants).
  app.get(BASE, async (req, reply) => {
    const indice = (await exp.listarOrganizaciones()) as { organizaciones?: ReadonlyArray<{ org: string }>; version?: number };
    const todas = indice.organizaciones ?? [];
    const propia = (req.headers['x-organization-id'] as string | undefined) ?? null;
    if (propia === null) return reply.send(opts.demoSinAuth === true ? indice : { ...indice, organizaciones: [] });
    return reply.send({ ...indice, organizaciones: todas.filter((o) => o.org === propia) });
  });

  app.post(BASE, async (req, reply) => {
    const b = (req.body ?? {}) as { org?: string; negocio?: Record<string, string>; perfil?: unknown };
    if (falta(b.org) || !b.negocio || falta(b.negocio.nombre)) return reply.code(400).send({ error: 'DatosNegocioRequeridos' });
    mismoTenant(req, b.org!);
    return reply.code(201).send(await exp.registrarNegocio(b.org!, b.negocio as never, b.perfil as never));
  });

  app.get(`${BASE}/:org`, async (req, reply) => {
    const { org } = req.params as { org: string };
    mismoTenant(req, org);
    return reply.send(await exp.cargarNegocio(org));
  });

  // ── Programas ───────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/:org/programas`, async (req, reply) => {
    const { org } = req.params as { org: string };
    mismoTenant(req, org);
    return reply.send(await exp.listarProgramas(org));
  });

  app.post(`${BASE}/:org/programas`, async (req, reply) => {
    const { org } = req.params as { org: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { programaId?: string; nombre?: string };
    if (falta(b.nombre)) return reply.code(400).send({ error: 'NombreProgramaRequerido' });
    const programaId = b.programaId?.trim() || randomUUID();
    return reply.code(201).send(await exp.crearPrograma(org, programaId, b as never));
  });

  app.get(`${BASE}/:org/programas/:programaId`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const vista = await exp.estadoPrograma(org, programaId);
    if (!vista) return reply.code(404).send({ error: 'ProgramaNoEncontrado' });
    return reply.send(vista);
  });

  app.post(`${BASE}/:org/programas/:programaId/segmentos`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { id?: string; nombre?: string };
    if (falta(b.id) || falta(b.nombre)) return reply.code(400).send({ error: 'SegmentoInvalido' });
    return reply.code(201).send(await exp.agregarSegmento(org, programaId, b as never));
  });

  app.post(`${BASE}/:org/programas/:programaId/hipotesis`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { id?: string; segmentoId?: string; mensaje?: string };
    if (falta(b.id) || falta(b.segmentoId)) return reply.code(400).send({ error: 'HipotesisInvalida' });
    return reply.code(201).send(await exp.agregarHipotesis(org, programaId, b as never));
  });

  app.post(`${BASE}/:org/programas/:programaId/campanias`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { segmentoId?: string; hipotesisId?: string; presupuestoSimulado?: number };
    if (falta(b.segmentoId) || falta(b.hipotesisId)) return reply.code(400).send({ error: 'CampaniaInvalida' });
    return reply.code(201).send(await exp.vincularCampania(org, programaId, b as never));
  });

  app.post(`${BASE}/:org/programas/:programaId/contenidos`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { campaignId?: string; contenido?: Record<string, unknown> };
    if (falta(b.campaignId) || !b.contenido) return reply.code(400).send({ error: 'ContenidoInvalido' });
    return reply.code(201).send(await exp.vincularContenido(org, programaId, b.campaignId!, b.contenido as never));
  });

  app.post(`${BASE}/:org/programas/:programaId/listo`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    return reply.code(201).send(await exp.marcarListo(org, programaId));
  });

  // ── Ciclo + modo seguro ─────────────────────────────────────────────────────────────────────
  app.post(`${BASE}/:org/programas/:programaId/ejecutar-ciclo`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    return reply.code(201).send(await exp.ejecutarCiclo(org, programaId));
  });

  app.post(`${BASE}/:org/programas/:programaId/pausar`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { motivo?: string };
    return reply.code(201).send(await exp.pausar(org, programaId, b.motivo ?? ''));
  });

  app.post(`${BASE}/:org/programas/:programaId/reanudar`, async (req, reply) => {
    const { org, programaId } = req.params as { org: string; programaId: string };
    mismoTenant(req, org);
    const b = (req.body ?? {}) as { actorHumano?: string; motivo?: string };
    if (falta(b.actorHumano)) return reply.code(400).send({ error: 'ActorHumanoRequerido' });
    return reply.code(201).send(await exp.reanudar(org, programaId, b.actorHumano!, b.motivo ?? ''));
  });
}
