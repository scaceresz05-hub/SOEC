/**
 * apps/api · VERIFICACIÓN DEL ANUNCIANTE · servicio de la confirmación humana.
 *
 * Lo que aquí se registra es una frase de una persona: **«completé lo que Google me pidió para esta cuenta»**.
 * No es «Google aprobó la empresa» —eso no lo sabemos y no lo vamos a escribir en ninguna parte— ni un
 * permiso para nada. Es el único dato disponible cuando el proveedor se niega a contestar, y se guarda con
 * el nombre exacto de lo que es.
 *
 * No se pide ni un documento, ni un RUT, ni una respuesta legal: SOEC no puede declarar por nadie y tampoco
 * quiere custodiar lo que respalda esa declaración. La cuenta la resuelve el servidor desde el SSOT, nunca el
 * navegador; si la empresa cambia de cuenta, lo confirmado sobre la anterior deja de valer solo.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioConfirmacionDeVerificacion, type ConfirmacionDeVerificacion } from './verificacion-pg';
import type { LecturaVerificacion, PuertoVerificacionAnunciante } from './verificacion-tipos';

export interface DepsVerificacionService {
  readonly puerto: PuertoVerificacionAnunciante;
  /** Cuenta elegida ahora mismo. `null` ⇒ no hay nada que confirmar todavía. */
  readonly cuentaElegida: (org: string) => Promise<string | null>;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
}

export class NoHayCuentaQueVerificarError extends Error {}

export class VerificacionService {
  private readonly repo: RepositorioConfirmacionDeVerificacion;
  private readonly negocios: RepositorioNegocios;

  constructor(private readonly pool: Pool, private readonly deps: DepsVerificacionService) {
    this.repo = new RepositorioConfirmacionDeVerificacion(pool);
    this.negocios = new RepositorioNegocios(pool);
  }

  async estado(org: string): Promise<LecturaVerificacion> {
    return this.deps.puerto.inspeccionar(org);
  }

  /**
   * Registra la confirmación de la persona sobre la cuenta que está elegida ahora. Idempotente por cuenta:
   * confirmarlo dos veces no son dos hechos.
   */
  async confirmar(org: string, actor: string): Promise<ConfirmacionDeVerificacion> {
    const customerId = await this.deps.cuentaElegida(org);
    if (customerId === null || customerId.trim() === '') {
      throw new NoHayCuentaQueVerificarError('todavía no hay una cuenta de anuncios elegida sobre la que confirmar');
    }
    const ahora = (this.deps.ahora ?? ((): string => new Date().toISOString()))();
    const propuesta: ConfirmacionDeVerificacion = {
      id: `ver-${randomUUID().slice(0, 12)}`,
      organizationId: org, proveedor: 'GOOGLE_ADS', customerId, actor, confirmadoPorPersonaEn: ahora,
    };

    const guardada = await this.enTransaccion(async (tx) => {
      const c = await this.repo.registrar(tx, propuesta);
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor,
        // El nombre de la acción dice QUIÉN afirma: no es una aprobación del proveedor.
        action: 'ADVERTISER_VERIFICATION_CONFIRMED_BY_HUMAN',
        changedFields: { proveedor: 'GOOGLE_ADS', cuenta: customerId, at: ahora },
      });
      return c;
    });
    this.deps.log?.({ verificacion: 'confirmada-por-persona', org, cuenta: customerId });
    return guardada;
  }

  async confirmacionVigente(org: string): Promise<ConfirmacionDeVerificacion | null> {
    return this.repo.vigente(org, await this.deps.cuentaElegida(org));
  }

  private async enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
}
