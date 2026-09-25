/**
 * apps/api · VERIFICACIÓN DEL ANUNCIANTE · superficie HTTP.
 *
 * `GET /verificacion` dice en qué estado está —incluido el diagnóstico técnico sanitizado, que existe porque
 * su ausencia nos costó dos vueltas a ciegas—. `POST /verificacion/confirmacion` registra que una persona
 * completó en Google lo que Google le pidió.
 *
 * El cuerpo de esa confirmación va VACÍO a propósito: no se pide ni un documento, ni un número de
 * identificación, ni una respuesta legal. SOEC no declara por nadie y tampoco quiere custodiar lo que
 * respalda esa declaración. La cuenta la resuelve el servidor desde el SSOT, nunca el navegador.
 *
 * Y lo que esta ruta NO hace: no crea mandato, no autoriza gasto, no enciende escritura ni autonomía, y no
 * activa campañas. Confirmar no es aprobar, y aprobar no sería permiso para gastar.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe } from '../superficie-auth';
import { cuentaElegidaDe } from '../facturacion/composicion';
import { puertoVerificacionGoogle } from './composicion';
import { NoHayCuentaQueVerificarError, VerificacionService, type DepsVerificacionService } from './verificacion-service';
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';

export interface OpcionesVerificacionRoutes {
  readonly composicionGoogleAds?: ComponentesFlujoGoogleAds | null;
  readonly env?: Record<string, string | undefined>;
  /** Override completo, sólo para pruebas deterministas. */
  readonly deps?: DepsVerificacionService;
  readonly log?: (info: Record<string, unknown>) => void;
}

export function registerVerificacionRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesVerificacionRoutes = {}): void {
  const servicio = (): VerificacionService => new VerificacionService(pool, opciones.deps ?? {
    puerto: puertoVerificacionGoogle(pool, {
      env: opciones.env ?? process.env,
      composicionGoogleAds: opciones.composicionGoogleAds ?? null,
      ...(opciones.log ? { log: opciones.log } : {}),
    }),
    cuentaElegida: (org) => cuentaElegidaDe(pool, org),
    ...(opciones.log ? { log: opciones.log } : {}),
  });

  app.get('/verificacion', async (req: FastifyRequest, reply) => {
    const org = String(contextoDe(req).organizationId);
    const s = servicio();
    const [v, confirmacion] = await Promise.all([s.estado(org), s.confirmacionVigente(org)]);
    return reply.send({
      organizationId: org,
      estado: v.estado,
      explicacion: v.explicacion,
      fechaLimite: v.fechaLimite,
      // Diagnóstico TÉCNICO y sanitizado, para quien opera: nunca el cuerpo crudo del proveedor.
      diagnostico: v.diagnostico,
      programas: v.programas,
      httpProveedor: v.httpProveedor,
      // Cuándo lo confirmó una persona. El nombre no dice «verificado»: dice quién lo afirma.
      confirmadoPorPersonaEn: confirmacion?.confirmadoPorPersonaEn ?? null,
    });
  });

  app.post('/verificacion/confirmacion', async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = contextoDe(req);
    const org = String(ctx.organizationId);
    try {
      const s = servicio();
      const c = await s.confirmar(org, String(ctx.actor ?? 'persona'));
      return reply.send({
        organizationId: org,
        confirmadoPorPersonaEn: c.confirmadoPorPersonaEn,
        estado: (await s.estado(org)).estado,
      });
    } catch (e) {
      if (e instanceof NoHayCuentaQueVerificarError) {
        return reply.code(409).send({ error: 'SIN_CUENTA_ELEGIDA', message: e.message });
      }
      throw e;
    }
  });
}
