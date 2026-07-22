/**
 * Proveedor de canal EMULADO (F2-CHAN-01 §17). Servicio externo de desarrollo,
 * AISLADO del dominio de SOEC (ninguna dependencia @soec/*): emula el comportamiento
 * de un proveedor real (API HTTP, autenticación, identificadores externos, estados,
 * idempotencia, rate limiting, borrado, webhooks y escenarios de fallo) para validar
 * la frontera de red y el adaptador. Memoria propia, reiniciable. NO es un efecto
 * externo real: publica en su propio almacén en memoria, nunca en una plataforma pública.
 */
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

export type EscenarioEmulador =
  | 'success_immediate'
  | 'processing_async'
  | 'timeout_after_create'
  | 'rate_limit'
  | 'invalid_credential'
  | 'invalid_payload'
  | 'webhook_lost'
  | 'permanent_error';

export type EstadoPostEmu = 'accepted' | 'processing' | 'published' | 'deleted';

export interface PostEmu {
  externalId: string;
  idempotencyKey: string | null;
  account: string;
  status: EstadoPostEmu;
  content: string;
  title: string;
  requiereArchivoReal: boolean;
  createdAt: string;
  publishedAt: string | null;
}

export interface WebhookEmu {
  id: string;
  tipo: string;
  externalId: string;
  status: EstadoPostEmu;
  firma: string;
  enviadoEn: string;
}

export const SECRETO_WEBHOOK_DEV = 'emu-webhook-secret-dev';
const TOKEN_VALIDO_DEV = 'emu-token-valido-dev';

export function firmarWebhook(cuerpo: string): string {
  return createHmac('sha256', SECRETO_WEBHOOK_DEV).update(cuerpo).digest('hex');
}

interface Config {
  escenario: EscenarioEmulador;
  tokensValidos: Set<string>;
  limitePorVentana: number; // 0 = sin límite
  relojIso: string;
}

export type EscenarioMetricas =
  | 'alto'
  | 'bajo'
  | 'sin_datos'
  | 'retrasado'
  | 'duplicado'
  | 'correccion'
  | 'inconsistente'
  | 'gasto_parcial'
  | 'gasto_excedido'
  | 'fuera_de_orden';

export interface FilaMetrica {
  externalId: string;
  metrica: string;
  valor: number;
  unidad: string;
  moneda: string | null;
  periodo: string;
  ocurridoEn: string;
  proveedorSeq: number;
  acumulativa: boolean;
  estimada: boolean;
}
export interface ConversionEmu {
  id: string;
  externalId: string | null;
  campaignRef: string | null;
  valor: number;
  atribuible: boolean;
  ocurridoEn: string;
}

/** Hash determinista [0, mod) a partir de una cadena (sin azar). */
function hnum(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 131 + s.charCodeAt(i)) % 1_000_003;
  return h % mod;
}

/** Estado en memoria del emulador; reiniciable y observable desde las pruebas. */
export class EstadoEmulador {
  posts = new Map<string, PostEmu>();
  porIdem = new Map<string, string>(); // idempotencyKey -> externalId
  webhooks: WebhookEmu[] = [];
  conversiones: ConversionEmu[] = [];
  escenarioMetricas: EscenarioMetricas = 'alto';
  private consultasMetricas = new Map<string, number>();
  private seq = 0;
  private reqCount = 0;
  config: Config = { escenario: 'success_immediate', tokensValidos: new Set([TOKEN_VALIDO_DEV]), limitePorVentana: 0, relojIso: '2026-07-21T00:00:00.000Z' };

  reset(): void {
    this.posts.clear();
    this.porIdem.clear();
    this.webhooks = [];
    this.conversiones = [];
    this.escenarioMetricas = 'alto';
    this.consultasMetricas.clear();
    this.seq = 0;
    this.reqCount = 0;
    this.config = { escenario: 'success_immediate', tokensValidos: new Set([TOKEN_VALIDO_DEV]), limitePorVentana: 0, relojIso: '2026-07-21T00:00:00.000Z' };
  }
  setEscenario(e: EscenarioEmulador): void {
    this.config.escenario = e;
  }
  setEscenarioMetricas(e: EscenarioMetricas): void {
    this.escenarioMetricas = e;
  }
  setLimite(n: number): void {
    this.config.limitePorVentana = n;
  }
  nuevoId(account: string): string {
    this.seq += 1;
    return `ext-${account}-${this.seq}`;
  }
  contarPeticion(): number {
    this.reqCount += 1;
    return this.reqCount;
  }

  /** Métricas DETERMINISTAS por publicación y escenario. Modela retrasos, correcciones,
   * duplicados, inconsistencias y gasto según el escenario activo. */
  metricasDe(externalId: string): FilaMetrica[] {
    const esc = this.escenarioMetricas;
    if (esc === 'sin_datos') return [];
    const n = (this.consultasMetricas.get(externalId) ?? 0) + 1;
    this.consultasMetricas.set(externalId, n);
    const base = hnum(externalId, 50) + 50; // 50..99 impresiones base
    const periodo = this.config.relojIso.slice(0, 10);
    const alto = esc === 'alto';
    const factorConv = alto ? 0.08 : esc === 'bajo' ? 0.005 : 0.03;
    const impresiones = esc === 'retrasado' && n === 1 ? Math.floor(base / 5) : base * 20;
    const clics = Math.floor(impresiones * (alto ? 0.05 : 0.01));
    let leads = Math.floor(clics * (alto ? 0.4 : 0.15));
    const conversiones = Math.floor(clics * factorConv);
    let gasto = esc === 'gasto_parcial' ? base : esc === 'gasto_excedido' ? base * 100 : base * 4;
    if (esc === 'correccion' && n >= 2) {
      leads += 3; // corrección posterior: llegan más leads
      gasto += 10;
    }
    const fila = (metrica: string, valor: number, unidad: string, moneda: string | null, estimada = false, seqExtra = 0): FilaMetrica => ({
      externalId,
      metrica,
      valor,
      unidad,
      moneda,
      periodo,
      ocurridoEn: this.config.relojIso,
      proveedorSeq: n + seqExtra,
      acumulativa: true,
      estimada,
    });
    const filas: FilaMetrica[] = [
      fila('impresiones', impresiones, 'conteo', null),
      fila('clics', clics, 'conteo', null),
      fila('leads', leads, 'conteo', null),
      fila('conversiones', conversiones, 'conteo', null, esc === 'inconsistente'),
      fila('gasto', gasto, 'monetario', 'CLP'),
    ];
    if (esc === 'duplicado') filas.push(fila('clics', clics, 'conteo', null)); // fila duplicada exacta
    if (esc === 'inconsistente') filas.push(fila('conversiones', conversiones + impresiones, 'conteo', null, true)); // conversiones > impresiones (imposible)
    if (esc === 'fuera_de_orden') filas.forEach((f, i) => (filas[i] = { ...f, proveedorSeq: filas.length - i }));
    return filas;
  }
}

function token(req: FastifyRequest): string | null {
  const h = req.headers['authorization'];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v || !v.startsWith('Bearer ')) return null;
  return v.slice('Bearer '.length);
}
function account(req: FastifyRequest): string {
  const h = req.headers['x-emu-account'];
  const v = Array.isArray(h) ? h[0] : h;
  return v || 'cuenta-demo';
}

export const TOKEN_DEMO = TOKEN_VALIDO_DEV;

export function buildEmulador(estado: EstadoEmulador = new EstadoEmulador()): { app: FastifyInstance; estado: EstadoEmulador } {
  const app = Fastify({ logger: false });

  function autenticar(req: FastifyRequest, reply: FastifyReply): boolean {
    if (estado.config.escenario === 'invalid_credential') {
      reply.code(401).send({ error: 'invalid_credential', message: 'credencial inválida (escenario)' });
      return false;
    }
    const t = token(req);
    if (!t || !estado.config.tokensValidos.has(t)) {
      reply.code(401).send({ error: 'invalid_credential', message: 'token ausente o inválido' });
      return false;
    }
    return true;
  }

  function limitado(reply: FastifyReply): boolean {
    const n = estado.contarPeticion();
    const forzar = estado.config.escenario === 'rate_limit';
    const excede = estado.config.limitePorVentana > 0 && n > estado.config.limitePorVentana;
    if (forzar || excede) {
      reply.header('retry-after', '2').code(429).send({ error: 'rate_limited', message: 'límite de peticiones alcanzado' });
      return true;
    }
    return false;
  }

  app.post('/v1/posts', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    if (limitado(reply)) return reply;
    const body = (req.body ?? {}) as { content?: string; title?: string; idempotencyKey?: string; requiereArchivoReal?: boolean; assetsReales?: number };
    const idem = (Array.isArray(req.headers['idempotency-key']) ? req.headers['idempotency-key'][0] : req.headers['idempotency-key']) ?? body.idempotencyKey ?? null;

    if (estado.config.escenario === 'permanent_error') return reply.code(500).send({ error: 'provider_error', message: 'error permanente del proveedor (escenario)' });
    if (estado.config.escenario === 'invalid_payload' || !body.content || body.content.trim() === '') {
      return reply.code(422).send({ error: 'invalid_payload', message: 'contenido vacío o inválido' });
    }

    // Idempotencia: la misma clave nunca crea dos publicaciones.
    if (idem && estado.porIdem.has(idem)) {
      const id = estado.porIdem.get(idem)!;
      const p = estado.posts.get(id)!;
      return reply.code(200).send({ externalId: id, status: p.status, duplicate: true, createdAt: p.createdAt });
    }

    const acc = account(req);
    const externalId = estado.nuevoId(acc);
    // 'timeout_after_create' publica de forma SÍNCRONA pero pierde la respuesta (504):
    // el objeto queda publicado y la reconciliación lo confirma. Solo processing_async
    // y webhook_lost dejan el objeto en 'processing' a la espera de /process.
    const asincrono = estado.config.escenario === 'processing_async' || estado.config.escenario === 'webhook_lost';
    const post: PostEmu = {
      externalId,
      idempotencyKey: idem,
      account: acc,
      status: asincrono ? 'processing' : 'published',
      content: body.content,
      title: body.title ?? '',
      requiereArchivoReal: body.requiereArchivoReal === true && (body.assetsReales ?? 0) === 0,
      createdAt: estado.config.relojIso,
      publishedAt: asincrono ? null : estado.config.relojIso,
    };
    estado.posts.set(externalId, post);
    if (idem) estado.porIdem.set(idem, externalId);

    // Timeout tras creación: el objeto SE CREÓ, pero la respuesta "se pierde" (504).
    if (estado.config.escenario === 'timeout_after_create') {
      return reply.code(504).send({ error: 'gateway_timeout', message: 'respuesta perdida tras crear (escenario)' });
    }
    return reply.code(201).send({ externalId, status: post.status, createdAt: post.createdAt });
  });

  app.get('/v1/posts', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { idempotencyKey } = req.query as { idempotencyKey?: string };
    if (idempotencyKey && estado.porIdem.has(idempotencyKey)) {
      const p = estado.posts.get(estado.porIdem.get(idempotencyKey)!)!;
      return reply.send({ encontrado: true, post: p });
    }
    return reply.send({ encontrado: false, post: null });
  });

  app.get('/v1/posts/:id', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const p = estado.posts.get(id);
    if (!p || p.status === 'deleted') return reply.code(404).send({ error: 'not_found' });
    return reply.send(p);
  });

  app.delete('/v1/posts/:id', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const p = estado.posts.get(id);
    if (!p || p.status === 'deleted') return reply.code(404).send({ error: 'not_found' });
    p.status = 'deleted';
    return reply.send({ externalId: id, status: 'deleted' });
  });

  // Avanza una publicación asíncrona a 'published' y encola un webhook (salvo webhook_lost).
  app.post('/v1/posts/:id/process', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const p = estado.posts.get(id);
    if (!p || p.status === 'deleted') return reply.code(404).send({ error: 'not_found' });
    p.status = 'published';
    p.publishedAt = estado.config.relojIso;
    if (estado.config.escenario !== 'webhook_lost') {
      encolarWebhook(estado, 'post.published', p);
    }
    return reply.send({ externalId: id, status: 'published' });
  });

  app.post('/v1/webhooks/test', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { externalId } = (req.body ?? {}) as { externalId?: string };
    const p = externalId ? estado.posts.get(externalId) : undefined;
    if (!p) return reply.code(404).send({ error: 'not_found' });
    encolarWebhook(estado, 'post.published', p);
    return reply.send({ ok: true });
  });

  // Los webhooks pendientes son recuperables por las pruebas para simular la entrega.
  app.get('/v1/webhooks/pending', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    return reply.send({ webhooks: estado.webhooks });
  });

  // ── Métricas (F2-MET-01 §9) ──────────────────────────────────────────────
  app.get('/v1/posts/:id/metrics', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { id } = req.params as { id: string };
    if (!estado.posts.has(id)) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ externalId: id, metrics: estado.metricasDe(id), escenario: estado.escenarioMetricas });
  });

  // Métricas de todas las publicaciones (soporta cursor por índice de publicación).
  app.get('/v1/metrics', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { cursor } = req.query as { cursor?: string };
    const ids = [...estado.posts.keys()].filter((k) => estado.posts.get(k)!.status !== 'deleted').sort();
    const desde = cursor ? Math.max(0, ids.indexOf(cursor) + 1) : 0;
    const pagina = ids.slice(desde);
    const metrics = pagina.flatMap((id) => estado.metricasDe(id));
    const nuevoCursor = pagina.length > 0 ? pagina[pagina.length - 1] : cursor ?? null;
    return reply.send({ metrics, cursor: nuevoCursor, conversiones: estado.conversiones });
  });

  app.post('/v1/metrics/scenario', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const { escenario } = (req.body ?? {}) as { escenario?: string };
    if (!escenario) return reply.code(422).send({ error: 'escenario_requerido' });
    estado.setEscenarioMetricas(escenario as never);
    return reply.send({ ok: true, escenario });
  });

  app.post('/v1/conversions', async (req, reply) => {
    if (!autenticar(req, reply)) return reply;
    const b = (req.body ?? {}) as { externalId?: string; campaignRef?: string; valor?: number };
    const atribuible = !!b.campaignRef;
    const conv = { id: `conv-${estado.conversiones.length + 1}`, externalId: b.externalId ?? null, campaignRef: b.campaignRef ?? null, valor: b.valor ?? 1, atribuible, ocurridoEn: estado.config.relojIso };
    estado.conversiones.push(conv);
    return reply.code(201).send(conv);
  });

  return { app, estado };
}

function encolarWebhook(estado: EstadoEmulador, tipo: string, p: PostEmu): void {
  const cuerpo = JSON.stringify({ tipo, externalId: p.externalId, status: p.status });
  estado.webhooks.push({ id: `wh-${p.externalId}-${estado.webhooks.length + 1}`, tipo, externalId: p.externalId, status: p.status, firma: firmarWebhook(cuerpo), enviadoEn: estado.config.relojIso });
}
