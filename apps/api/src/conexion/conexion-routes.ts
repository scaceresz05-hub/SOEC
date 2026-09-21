/**
 * apps/api · CONEXIONES COMO DATO · superficie HTTP.
 *
 * Se registra DENTRO del gateway vertical: la sesión y la membresía ya están validadas y la organización del
 * contexto es AUTORITATIVA (nunca la de la URL ni la del cuerpo). Leer exige contexto; cambiar algo exige
 * además el permiso `business.manage`, igual que editar el negocio.
 *
 * Ninguna respuesta de este módulo contiene el valor de una credencial ni su referencia: sólo si está
 * configurada y de qué clase es. Es una regla verificada por prueba, no una intención.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { estadoDeCompatibilidadLegado } from '../plataforma/registro';
import { ConexionInvalidaError } from './conexion-tipos';
import {
  ConexionNoEncontradaError,
  ConexionService,
  DepositoNoDisponibleError,
  NegocioSinPerfilError,
  exigirCapacidad,
  exigirProveedor,
  type DepsConexionService,
  type EntradaGrowth,
} from './conexion-service';

function manejarError(e: unknown, reply: FastifyReply): FastifyReply {
  if (e instanceof ConexionInvalidaError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
  if (e instanceof NegocioSinPerfilError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: e.message });
  if (e instanceof ConexionNoEncontradaError) return reply.code(404).send({ error: 'CONEXION_NO_ENCONTRADA', message: e.message });
  if (e instanceof DepositoNoDisponibleError) return reply.code(503).send({ error: 'DEPOSITO_NO_DISPONIBLE', message: e.message });
  throw e;
}

export function registerConexionRoutes(app: FastifyInstance, pool: Pool, deps: DepsConexionService): void {
  const svc = new ConexionService(pool, deps);

  /** Organización del CONTEXTO autenticado + comprobación de permiso de escritura cuando corresponde. */
  const org = (req: FastifyRequest): { org: string; actor: string } => {
    const ctx = contextoDe(req);
    return { org: String(ctx.organizationId), actor: String(ctx.actor) };
  };
  const puedeGestionar = (req: FastifyRequest): boolean => permisosDe(req).has('business.manage');

  // ── ESTADO: qué está conectado y qué está habilitado ──
  app.get('/conexiones', async (req, reply) => {
    const { org: o } = org(req);
    try {
      return reply.send(await svc.estado(o));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── CONECTAR el puente Growth (endpoint + token). El token se cifra y no vuelve a salir ──
  app.post('/conexiones/growth', async (req, reply) => {
    const { org: o, actor } = org(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await svc.guardarGrowth(o, actor, (req.body ?? {}) as EntradaGrowth));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── DECLARAR la cuenta y la campaña de Google Ads (el token lo gestiona el flujo OAuth existente) ──
  app.post('/conexiones/google-ads', async (req, reply) => {
    const { org: o, actor } = org(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await svc.guardarGoogleAds(o, actor, (req.body ?? {}) as Record<string, unknown>));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── PROBAR una conexión: una lectura mínima, sin escrituras y sin devolver el cuerpo del proveedor ──
  app.post('/conexiones/:provider/probar', async (req, reply) => {
    const { org: o, actor } = org(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      const p = exigirProveedor((req.params as { provider: string }).provider.toUpperCase().replace(/-/g, '_'));
      return reply.send(await svc.probar(o, actor, p));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── DESHABILITAR una conexión y olvidar su credencial ──
  app.post('/conexiones/:provider/deshabilitar', async (req, reply) => {
    const { org: o, actor } = org(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      const p = exigirProveedor((req.params as { provider: string }).provider.toUpperCase().replace(/-/g, '_'));
      return reply.send(await svc.deshabilitar(o, actor, p));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── CAPACIDADES: encender o apagar lo que el negocio tiene permitido hacer ──
  app.patch('/capacidades', async (req, reply) => {
    const { org: o, actor } = org(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    const cuerpo = (req.body ?? {}) as { capacidad?: string; habilitada?: boolean; nota?: string | null };
    try {
      const cap = exigirCapacidad(cuerpo.capacidad);
      if (typeof cuerpo.habilitada !== 'boolean') {
        return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'habilitada debe ser true o false' });
      }
      return reply.send(await svc.fijarCapacidad(o, actor, cap, cuerpo.habilitada, cuerpo.nota ?? null));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  /**
   * TELEMETRÍA de compatibilidad de ESTE negocio: de dónde sale su configuración y qué campos siguen
   * viniendo del módulo TypeScript histórico. Para una empresa nueva la lista está vacía, y eso es
   * precisamente lo que hay que poder comprobar. Sólo la propia organización: nunca el mapa del despliegue.
   */
  app.get('/conexiones/procedencia', async (req, reply) => {
    const { org: o } = org(req);
    const propia = estadoDeCompatibilidadLegado().organizaciones.find((x) => x.org === o) ?? null;
    return reply.send({
      organizationId: o,
      procedencia: propia?.origen ?? null,
      camposDelRegistro: propia?.camposDelRegistro ?? [],
      usosDelRegistro: propia?.usos ?? 0,
    });
  });
}
