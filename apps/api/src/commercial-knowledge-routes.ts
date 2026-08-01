/**
 * Superficie AUTENTICADA del CONOCIMIENTO COMERCIAL (CRM) — mínima para alimentar el Motor de Generación
 * (A-1). Sin esta superficie, un usuario real no puede cargar el conocimiento que el orquestador necesita
 * y `start` siempre ABSTIENE. Se registra DENTRO del gateway vertical (sesión→401, membresía→404, CSRF,
 * cabeceras de seguridad heredadas) y exige permisos atómicos del modelo canónico (403). Reutiliza
 * @soec/crm-comercial (no duplica su dominio). La organización viene del contexto autenticado, no de la URL.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { type Attribution, type EventStore } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import type { TipoPerfil } from '@soec/crm-comercial';
import type { TipoEvidencia } from '@soec/negocio';
import { RateLimiter } from './rate-limit';
import { contextoDe, exigir } from './superficie-auth';

const BASE = '/commercial-knowledge';
const BODY_LIMIT = 16 * 1024;
const TIPOS_PERFIL: readonly TipoPerfil[] = ['EMPRESA', 'PRODUCTO', 'SERVICIO', 'CLIENTE_IDEAL', 'COMPETIDOR', 'MERCADO'];
const ORIGENES: readonly TipoEvidencia[] = ['HECHO_VERIFICADO', 'DATO_DECLARADO_POR_USUARIO', 'DATO_IMPORTADO', 'INFERENCIA', 'HIPOTESIS', 'ESTIMACION', 'SIMULACION', 'DESCONOCIDO'];

const ATRIBUCION: Attribution = {
  source: 'crm-comercial-ui',
  purpose: 'carga gobernada del conocimiento comercial para el motor de generación',
  assumptions: ['datos declarados por el usuario salvo indicación'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

function falta(v: unknown): boolean {
  return typeof v !== 'string' || !v.trim();
}

export function registerCommercialKnowledgeRoutes(app: FastifyInstance, store: EventStore, clock: Clock, rateLimit?: RateLimiter): void {
  const conocimiento = new ConocimientoComercialService(store);
  const hipotesis = new HipotesisComercialService(store);
  const limitador = rateLimit ?? new RateLimiter({ maxIntentos: 120, ventanaMs: 60_000, bloqueoMs: 30_000 });
  const opts = { config: { bodyLimit: BODY_LIMIT } };

  const limitar = (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, org: string): boolean => {
    const r = limitador.registrarFallo(`ck:${org}`);
    if (!r.permitido) {
      reply.header('retry-after', String(r.retryAfterSeg)).code(429).send({ error: 'RATE_LIMIT', message: 'demasiadas escrituras de conocimiento; reintente' });
      return false;
    }
    return true;
  };

  // ── Lectura del conocimiento y cobertura ──────────────────────────────────────────────────────
  app.get(BASE, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_knowledge.read');
    const state = await conocimiento.cargar(ctx);
    // La EMPRESA se guarda aparte (state.empresa); el resto en state.entidades. Se listan juntas.
    const todas = [...(state.empresa ? [state.empresa] : []), ...Object.values(state.entidades)];
    const entidades = todas.map((e) => ({ id: e.id, tipo: e.tipo, nombre: e.nombre, campos: Object.fromEntries(Object.entries(e.campos).map(([k, c]) => [k, { valor: c.valor, origen: c.origen }])) }));
    return reply.send({ entidades, naturaleza: 'SIMULADO' });
  });

  /** Cobertura mínima que el motor necesita: empresa + producto/servicio + ≥1 ICP + ≥1 hipótesis con segmento. */
  app.get(`${BASE}/coverage`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_knowledge.read');
    const state = await conocimiento.cargar(ctx);
    const ents = [...(state.empresa ? [state.empresa] : []), ...Object.values(state.entidades)];
    const idx = await hipotesis.listar(ctx);
    const hips = await Promise.all(idx.hipotesis.map((h) => hipotesis.cargar(ctx, h.hipotesisId)));
    const tiene = (t: TipoPerfil) => ents.some((e) => e.tipo === t);
    const icps = ents.filter((e) => e.tipo === 'CLIENTE_IDEAL').length;
    const hipConSegmento = hips.filter((h) => h.existe && h.segmentoId).length;
    const faltantes: string[] = [];
    if (!tiene('EMPRESA')) faltantes.push('falta la EMPRESA');
    if (!tiene('PRODUCTO') && !tiene('SERVICIO')) faltantes.push('falta un PRODUCTO o SERVICIO');
    if (icps === 0) faltantes.push('falta al menos un CLIENTE_IDEAL (ICP)');
    if (hipConSegmento === 0) faltantes.push('falta al menos una hipótesis con segmento asociado');
    return reply.send({ empresa: tiene('EMPRESA'), productoOServicio: tiene('PRODUCTO') || tiene('SERVICIO'), icps, hipotesisConSegmento: hipConSegmento, listoParaGenerar: faltantes.length === 0, faltantes, naturaleza: 'SIMULADO' });
  });

  // ── Entidades (empresa/producto/ICP/…) ────────────────────────────────────────────────────────
  app.post(`${BASE}/entities`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_knowledge.manage');
    if (!limitar(req, reply, String(ctx.organizationId))) return;
    const b = (req.body ?? {}) as { id?: string; tipo?: string; nombre?: string };
    if (!b.tipo || !TIPOS_PERFIL.includes(b.tipo as TipoPerfil) || falta(b.nombre)) {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'tipo (válido) y nombre requeridos' });
    }
    const id = b.id?.trim() || randomUUID();
    await conocimiento.registrarEntidad(ctx, id, b.tipo as TipoPerfil, b.nombre!.trim(), ATRIBUCION, clock.now());
    return reply.code(201).send({ id, tipo: b.tipo, nombre: b.nombre, naturaleza: 'SIMULADO' });
  });

  app.patch(`${BASE}/entities/:id`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_knowledge.manage');
    if (!limitar(req, reply, String(ctx.organizationId))) return;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { clave?: string; valor?: string; origen?: string };
    if (falta(b.clave) || falta(b.valor)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'clave y valor requeridos' });
    const origen = (b.origen && ORIGENES.includes(b.origen as TipoEvidencia) ? b.origen : 'DATO_DECLARADO_POR_USUARIO') as TipoEvidencia;
    await conocimiento.establecerCampo(ctx, id, b.clave!.trim(), b.valor!.trim(), origen, ATRIBUCION, clock.now());
    return reply.code(200).send({ id, clave: b.clave, origen, naturaleza: 'SIMULADO' });
  });

  // ── Hipótesis comerciales ─────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/hypotheses`, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_hypothesis.read');
    const idx = await hipotesis.listar(ctx);
    const hips = await Promise.all(idx.hipotesis.map((h) => hipotesis.cargar(ctx, h.hipotesisId)));
    return reply.send({ hipotesis: hips.filter((h) => h.existe).map((h) => ({ id: h.hipotesisId, enunciado: h.enunciado, contexto: h.contexto, estado: h.estado, segmentoId: h.segmentoId, evidencias: h.evidencias.length })), naturaleza: 'SIMULADO' });
  });

  app.post(`${BASE}/hypotheses`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_hypothesis.manage');
    if (!limitar(req, reply, String(ctx.organizationId))) return;
    const b = (req.body ?? {}) as { id?: string; enunciado?: string; contexto?: string; segmentoId?: string };
    if (falta(b.enunciado)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'enunciado requerido' });
    const id = b.id?.trim() || randomUUID();
    await hipotesis.registrar(ctx, id, b.enunciado!.trim(), b.contexto ?? '', ATRIBUCION, clock.now(), b.segmentoId ? { segmentoId: b.segmentoId } : undefined);
    return reply.code(201).send({ id, naturaleza: 'SIMULADO' });
  });

  app.post(`${BASE}/hypotheses/:id/evidence`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_hypothesis.manage');
    if (!limitar(req, reply, String(ctx.organizationId))) return;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { evidenciaId?: string; descripcion?: string; origen?: string; aFavor?: boolean };
    if (falta(b.descripcion)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'descripcion requerida' });
    const origen = (b.origen && ORIGENES.includes(b.origen as TipoEvidencia) ? b.origen : 'DATO_IMPORTADO') as TipoEvidencia;
    await hipotesis.agregarEvidencia(ctx, id, b.evidenciaId?.trim() || randomUUID(), b.descripcion!.trim(), origen, b.aFavor !== false, ATRIBUCION, clock.now());
    return reply.code(201).send({ id, naturaleza: 'SIMULADO' });
  });

  app.post(`${BASE}/hypotheses/:id/segment`, opts, async (req, reply) => {
    const ctx = contextoDe(req);
    exigir(req, 'commercial_hypothesis.manage');
    if (!limitar(req, reply, String(ctx.organizationId))) return;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { segmentoId?: string };
    if (falta(b.segmentoId)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'segmentoId requerido' });
    await hipotesis.asociarSegmento(ctx, id, b.segmentoId!.trim(), ATRIBUCION, clock.now());
    return reply.code(200).send({ id, segmentoId: b.segmentoId, naturaleza: 'SIMULADO' });
  });
}
