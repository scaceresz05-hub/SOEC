/**
 * Superficie AUTENTICADA del Motor de Generación Autónoma de Marketing (Macrobloque 3, Tramo J).
 *
 * Se registra DENTRO del gateway vertical ⇒ hereda: sesión obligatoria (401), membresía activa (404),
 * cabeceras de seguridad, y protección CSRF/Origin en métodos mutativos. Sobre esa base añade:
 *   - Autorización FINA por permiso atómico del modelo canónico (@soec/identity roles): 403 si falta.
 *     El permiso se lee de `x-permissions` (autoritativo, inyectado por el gateway); nunca del cliente.
 *   - La organización SIEMPRE viene del contexto autenticado (`x-organization-id`), nunca de la URL.
 *   - Rechazo explícito de modos reales: AUTONOMOUS_REAL / ejecución real → 422 gobernado (todo es SIMULADO).
 *   - Límite de payload por ruta y rate limiting de las acciones de generación (start/retry).
 *   - Trazabilidad/auditoría por event-sourcing: cada acción persiste eventos con Attribution + actor.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { contextoDe, exigir } from './superficie-auth';
import {
  AprobacionService,
  CalendarioEditorialService,
  EstrategiaCreativaArtefactoService,
  OrquestadorProgramaGenerativo,
  VariantesABService,
  estrategiaCreativaId,
  type DecisionAprobacion,
  type ParametrosCampania,
  type TipoRecurso,
} from '@soec/estrategia-creativa';
import { ProgramaService } from '@soec/programas';
import { RateLimiter } from './rate-limit';

const BASE = '/generation/programas';
const BODY_LIMIT = 32 * 1024; // 32 KB: los cuerpos de esta superficie son parámetros, no cargas grandes.

const ATRIBUCION: Attribution = {
  source: 'motor-generacion',
  purpose: 'generación gobernada de marketing (conexión del cerebro comercial con el pipeline)',
  assumptions: ['ejecución simulada; sin proveedores externos, sin gasto ni publicación real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};


function paramsDe(body: Record<string, unknown>): ParametrosCampania {
  const s = (k: string, def = ''): string => (typeof body[k] === 'string' ? (body[k] as string) : def);
  const n = (k: string, def: number): number => (typeof body[k] === 'number' && Number.isFinite(body[k]) ? (body[k] as number) : def);
  const arr = (k: string): string[] => (Array.isArray(body[k]) ? (body[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  const prioridad = s('prioridad', 'media');
  return {
    objetivoComercial: s('objetivoComercial'),
    objetivoMarketing: s('objetivoMarketing'),
    indicador: s('indicador', 'leads'),
    lineaBase: n('lineaBase', 0),
    valorEsperado: n('valorEsperado', 0),
    horizonteDias: n('horizonteDias', 30),
    prioridad: (['alta', 'media', 'baja'].includes(prioridad) ? prioridad : 'media') as ParametrosCampania['prioridad'],
    restricciones: arr('restricciones'),
    presupuestoTotal: n('presupuestoTotal', 0),
    frecuenciaDias: n('frecuenciaDias', 7),
    territorio: s('territorio', 'CL'),
    idioma: s('idioma', 'es'),
    moneda: s('moneda', 'CLP'),
    canales: arr('canales').length ? arr('canales') : ['correo'],
  };
}

/** Registra la superficie de generación. `rateLimit` opcional (por defecto, límite generoso de acciones). */
export function registerGeneracionRoutes(app: FastifyInstance, store: EventStore, clock: Clock, rateLimit?: RateLimiter): void {
  const orquestador = new OrquestadorProgramaGenerativo(store);
  const programas = new ProgramaService(store);
  const artefactos = new EstrategiaCreativaArtefactoService(store);
  const ab = new VariantesABService(store);
  const calendario = new CalendarioEditorialService(store);
  const aprobaciones = new AprobacionService(store);
  // Límite de acciones de generación (start/retry): frena disparos masivos. Estado en proceso (declarado).
  const limitador = rateLimit ?? new RateLimiter({ maxIntentos: 30, ventanaMs: 60_000, bloqueoMs: 60_000 });
  const opts = { config: { bodyLimit: BODY_LIMIT } };

  const limitar = (req: FastifyRequest, reply: FastifyReply, ctx: RequestContext, accion: string): boolean => {
    const clave = `gen:${accion}:${String(ctx.organizationId)}:${String(ctx.actor)}`;
    const r = limitador.registrarFallo(clave); // cada acción cuenta contra la ventana
    if (!r.permitido) {
      reply.header('retry-after', String(r.retryAfterSeg)).code(429).send({ error: 'RATE_LIMIT', message: 'demasiadas acciones de generación; reintente más tarde' });
      return false;
    }
    return true;
  };

  // ── Acciones (mutativas) ──────────────────────────────────────────────────────────────────────

  // Preparar/START: genera estrategias, campañas, contenido, A/B y calendario SIN ejecutar (deja las
  // piezas en espera de aprobación humana). Requiere generation.start.
  app.post(`${BASE}/:programaId/start`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'generation.start');
    if (!limitar(req, reply, ctx, 'start')) return;
    const { programaId } = req.params as { programaId: string };
    const res = await orquestador.prepararPrograma(ctx, programaId, paramsDe((req.body ?? {}) as Record<string, unknown>), ATRIBUCION, clock.now());
    if (res.tipo === 'ABSTENCION') return reply.code(422).send({ estado: 'ABSTENCION', faltantes: res.faltantes, naturaleza: 'SIMULADO' });
    return reply.code(201).send({ estado: 'PREPARADO', piezas: res.piezas, yaEjecutado: res.yaEjecutado, naturaleza: 'SIMULADO' });
  });

  // RETRY: reintenta la preparación (idempotente; repara fallos parciales). Requiere generation.retry.
  app.post(`${BASE}/:programaId/retry`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'generation.retry');
    if (!limitar(req, reply, ctx, 'retry')) return;
    const { programaId } = req.params as { programaId: string };
    const res = await orquestador.prepararPrograma(ctx, programaId, paramsDe((req.body ?? {}) as Record<string, unknown>), ATRIBUCION, clock.now());
    if (res.tipo === 'ABSTENCION') return reply.code(422).send({ estado: 'ABSTENCION', faltantes: res.faltantes, naturaleza: 'SIMULADO' });
    return reply.code(200).send({ estado: 'PREPARADO', piezas: res.piezas, yaEjecutado: res.yaEjecutado, naturaleza: 'SIMULADO' });
  });

  // APROBACIONES: decisión humana granular por recurso+versión. Requiere content.approve.
  app.post(`${BASE}/:programaId/approvals`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'content.approve');
    const { programaId } = req.params as { programaId: string };
    const b = (req.body ?? {}) as { resourceType?: string; resourceId?: string; resourceVersion?: number; decision?: string; comment?: string; scope?: string };
    const tipos: TipoRecurso[] = ['ESTRATEGIA_CREATIVA', 'CAMPANIA', 'PIEZA', 'VARIANTE', 'ENTRADA_CALENDARIO'];
    const decisiones: DecisionAprobacion[] = ['APROBADA', 'RECHAZADA', 'CAMBIOS_SOLICITADOS'];
    if (!b.resourceType || !tipos.includes(b.resourceType as TipoRecurso) || !b.resourceId || !b.decision || !decisiones.includes(b.decision as DecisionAprobacion) || typeof b.resourceVersion !== 'number') {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'resourceType, resourceId, resourceVersion y decision válidos requeridos' });
    }
    const st = await aprobaciones.decidir(ctx, { resourceType: b.resourceType as TipoRecurso, resourceId: b.resourceId, resourceVersion: b.resourceVersion, decision: b.decision as DecisionAprobacion, comment: b.comment ?? '', scope: b.scope ?? programaId }, ATRIBUCION, clock.now());
    return reply.code(201).send({ ultima: st.ultima, naturaleza: 'SIMULADO' });
  });

  // RUN-SIMULATED: ejecuta el ciclo simulado SOLO si las piezas tienen aprobación humana vigente.
  // Rechaza cualquier intento de modo real. Requiere execution.simulate.
  app.post(`${BASE}/:programaId/run-simulated`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'execution.simulate');
    const { programaId } = req.params as { programaId: string };
    const b = (req.body ?? {}) as { modo?: string; real?: boolean };
    if ((b.modo && b.modo !== 'PILOT' && b.modo !== 'SIMULADO') || b.real === true) {
      return reply.code(422).send({ error: 'MODO_REAL_BLOQUEADO', message: 'la ejecución real (AUTONOMOUS_REAL) está bloqueada; esta superficie es exclusivamente SIMULADA' });
    }
    const res = await orquestador.ejecutarSimulado(ctx, programaId, ATRIBUCION, clock.now());
    if (res.tipo === 'ABSTENCION') return reply.code(422).send({ estado: 'ABSTENCION', faltantes: res.faltantes });
    if (res.tipo === 'PENDIENTE_APROBACION') return reply.code(409).send({ estado: 'PENDIENTE_APROBACION', faltantes: res.faltantes });
    return reply.code(201).send({ estado: 'EJECUTADO_SIMULADO', vista: res.vista, naturaleza: 'SIMULADO' });
  });

  // ── Lecturas ──────────────────────────────────────────────────────────────────────────────────

  app.get(`${BASE}/:programaId`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'generation.read');
    const { programaId } = req.params as { programaId: string };
    const prog = await programas.cargar(ctx, programaId);
    if (!prog.existe) return reply.code(404).send({ error: 'ProgramaNoEncontrado' });
    return reply.send({ programaId, estado: prog.estado, segmentos: prog.segmentos.length, campanias: prog.campanias.length, piezas: prog.campanias.flatMap((c) => c.contenidoIds).length, naturaleza: 'SIMULADO' });
  });

  app.get(`${BASE}/:programaId/creative-strategies`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'creative.read');
    const { programaId } = req.params as { programaId: string };
    const prog = await programas.cargar(ctx, programaId);
    const items = [] as unknown[];
    for (const h of prog.hipotesis) {
      const art = await artefactos.cargar(ctx, estrategiaCreativaId(programaId, h.id));
      if (art.existe && art.artefacto) items.push(art.artefacto);
    }
    return reply.send({ estrategias: items, naturaleza: 'SIMULADO' });
  });

  app.get(`${BASE}/:programaId/campaigns`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'campaign.read');
    const { programaId } = req.params as { programaId: string };
    const prog = await programas.cargar(ctx, programaId);
    return reply.send({ campanias: prog.campanias.map((c) => ({ campaignId: c.campaignId, hipotesisId: c.hipotesisId, piezas: c.contenidoIds })), naturaleza: 'SIMULADO' });
  });

  app.get(`${BASE}/:programaId/content`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'content.read');
    const { programaId } = req.params as { programaId: string };
    const prog = await programas.cargar(ctx, programaId);
    return reply.send({ piezas: prog.campanias.flatMap((c) => c.contenidoIds.map((id) => ({ piezaId: id, campaignId: c.campaignId }))), naturaleza: 'SIMULADO' });
  });

  app.get(`${BASE}/:programaId/experiments`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'experiment.read');
    const { programaId } = req.params as { programaId: string };
    const prog = await programas.cargar(ctx, programaId);
    const experimentos = [] as unknown[];
    for (const pieza of prog.campanias.flatMap((c) => c.contenidoIds)) {
      const exp = await ab.cargar(ctx, pieza);
      if (exp.variantes.length) experimentos.push({ piezaId: pieza, variantes: exp.variantes });
    }
    return reply.send({ experimentos, naturaleza: 'SIMULADO' });
  });

  app.get(`${BASE}/:programaId/calendar`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'calendar.read');
    const { programaId } = req.params as { programaId: string };
    const cal = await calendario.cargar(ctx, programaId);
    return reply.send({ entradas: cal.entradas, naturaleza: 'SIMULADO' });
  });

  // Lista TODOS los recursos que exigen aprobación (piezas + variantes + entradas de calendario), cada uno
  // con su versión REAL y su última decisión, para que la UI apruebe lo que falte antes de ejecutar (B-4/B-5).
  app.get(`${BASE}/:programaId/approvals`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'generation.read');
    const { programaId } = req.params as { programaId: string };
    const recursos = await orquestador.recursosParaAprobar(ctx, programaId);
    const items = [] as unknown[];
    for (const r of recursos) {
      const st = await aprobaciones.cargar(ctx, r.tipo, r.resourceId);
      const aprobado = st.ultima?.decision === 'APROBADA' && st.ultima.resourceVersion === r.version;
      items.push({ resourceType: r.tipo, resourceId: r.resourceId, resourceVersion: r.version, aprobado, ultima: st.ultima });
    }
    return reply.send({ aprobaciones: items, naturaleza: 'SIMULADO' });
  });
}
