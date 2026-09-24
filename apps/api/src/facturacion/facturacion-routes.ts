/**
 * apps/api · FACTURACIÓN · superficie HTTP.
 *
 * `GET /facturacion` dice en qué estado está el pago de la cuenta elegida. Lectura pura.
 * `POST /facturacion/confirmacion` registra que una persona revisó el pago en Google y lo confirma.
 *
 * El cuerpo de esa confirmación está VACÍO a propósito, y es la decisión más importante de este archivo: no
 * se pide ningún dato de pago, porque no se quiere ninguno. La cuenta sobre la que se confirma la resuelve el
 * servidor desde el SSOT, no el navegador: confirmar es un acto sobre la cuenta que la empresa tiene elegida
 * ahora, no sobre la que alguien diga.
 *
 * Y lo que esta ruta no hace: no crea mandato, no autoriza gasto, no enciende escritura ni autonomía, y no
 * activa ninguna campaña. Esas puertas están en otro sitio, a propósito.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe } from '../superficie-auth';
import { cuentaElegidaDe, puertoFacturacionGoogle } from './composicion';
import { FacturacionService, NoHayCuentaQueConfirmarError, type DepsFacturacion } from './facturacion-service';
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';

export interface OpcionesFacturacionRoutes {
  readonly composicionGoogleAds?: ComponentesFlujoGoogleAds | null;
  readonly env?: Record<string, string | undefined>;
  /** Override completo, sólo para pruebas deterministas. */
  readonly deps?: DepsFacturacion;
  readonly log?: (info: Record<string, unknown>) => void;
}

export function registerFacturacionRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesFacturacionRoutes = {}): void {
  const servicio = (): FacturacionService => new FacturacionService(pool, opciones.deps ?? {
    puerto: puertoFacturacionGoogle(pool, {
      env: opciones.env ?? process.env,
      composicionGoogleAds: opciones.composicionGoogleAds ?? null,
      ...(opciones.log ? { log: opciones.log } : {}),
    }),
    cuentaElegida: (org) => cuentaElegidaDe(pool, org),
    ...(opciones.log ? { log: opciones.log } : {}),
  });

  app.get('/facturacion', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    const s = servicio();
    const [estado, confirmacion] = await Promise.all([s.estado(org), s.confirmacionVigente(org)]);
    return reply.send({
      organizationId: org,
      estado: estado.estado,
      explicacion: estado.explicacion,
      requiereConfirmacionHumana: estado.requiereConfirmacionHumana,
      // Se devuelve CUÁNDO se confirmó, nunca nada del medio de pago: no existe en el sistema.
      confirmadoEn: confirmacion?.confirmadoEn ?? null,
    });
  });

  app.post('/facturacion/confirmacion', async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = contextoDe(req);
    const org = String(ctx.organizationId);
    try {
      const c = await servicio().confirmar(org, String(ctx.actor ?? 'persona'));
      const estado = await servicio().estado(org);
      return reply.send({ organizationId: org, confirmadoEn: c.confirmadoEn, estado: estado.estado });
    } catch (e) {
      if (e instanceof NoHayCuentaQueConfirmarError) {
        return reply.code(409).send({ error: 'SIN_CUENTA_ELEGIDA', message: e.message });
      }
      throw e;
    }
  });
}
