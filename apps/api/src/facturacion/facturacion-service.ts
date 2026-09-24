/**
 * apps/api · FACTURACIÓN · el servicio: leer el estado y registrar la confirmación humana.
 *
 * Dos operaciones, muy asimétricas a propósito:
 *
 *  · LEER es constante y barato, y no escribe nada.
 *  · CONFIRMAR lo hace una persona, una vez por cuenta, y deja huella: quién, cuándo y sobre qué cuenta.
 *
 * Lo que la confirmación NO es, y conviene tenerlo escrito donde se implementa: no es un mandato financiero,
 * no autoriza gasto, no enciende escritura ni autonomía, y no contiene un solo dato financiero. Es una
 * persona diciendo «ya miré en Google, está puesto», porque Google no nos deja comprobarlo a nosotros.
 *
 * La cuenta viaja desde el SSOT, nunca desde el navegador: confirmar es un acto sobre la cuenta que la
 * empresa tiene elegida AHORA, y no sobre la que alguien diga.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioConfirmacionDePago } from './facturacion-pg';
import type { ConfirmacionDePago, LecturaFacturacion, PuertoFacturacionPublicitaria } from './facturacion-tipos';

export interface DepsFacturacion {
  readonly puerto: PuertoFacturacionPublicitaria;
  /** Cuenta elegida ahora mismo. `null` ⇒ no hay ninguna, y entonces no hay nada que confirmar. */
  readonly cuentaElegida: (org: string) => Promise<string | null>;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
}

export class NoHayCuentaQueConfirmarError extends Error {}

export class FacturacionService {
  private readonly repo: RepositorioConfirmacionDePago;
  private readonly negocios: RepositorioNegocios;

  constructor(private readonly pool: Pool, private readonly deps: DepsFacturacion) {
    this.repo = new RepositorioConfirmacionDePago(pool);
    this.negocios = new RepositorioNegocios(pool);
  }

  /** Estado actual. Solo lectura de punta a punta. */
  async estado(org: string): Promise<LecturaFacturacion> {
    return this.deps.puerto.inspeccionar(org);
  }

  /**
   * Registra que una persona confirmó el pago de la cuenta que está elegida ahora. Idempotente por cuenta:
   * confirmar dos veces no son dos hechos, es el mismo hecho con fecha nueva.
   */
  async confirmar(org: string, actor: string): Promise<ConfirmacionDePago> {
    const customerId = await this.deps.cuentaElegida(org);
    if (customerId === null || customerId.trim() === '') {
      throw new NoHayCuentaQueConfirmarError('todavía no hay una cuenta de anuncios elegida que confirmar');
    }
    const ahora = (this.deps.ahora ?? ((): string => new Date().toISOString()))();
    const propuesta: ConfirmacionDePago = {
      id: `pay-${randomUUID().slice(0, 12)}`,
      organizationId: org, proveedor: 'GOOGLE_ADS', customerId, actor, confirmadoEn: ahora,
    };

    const guardada = await this.enTransaccion(async (tx) => {
      const c = await this.repo.registrar(tx, propuesta);
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'PAYMENT_CONFIRMED_BY_HUMAN',
        // Se audita la CUENTA y el momento. Ningún dato de pago: no lo tenemos y no lo queremos.
        changedFields: { proveedor: 'GOOGLE_ADS', cuenta: customerId, at: ahora },
      });
      return c;
    });
    this.deps.log?.({ facturacion: 'confirmada-por-persona', org, cuenta: customerId });
    return guardada;
  }

  /** ¿Sigue valiendo lo confirmado? Sólo si es sobre la cuenta elegida ahora. */
  async confirmacionVigente(org: string): Promise<ConfirmacionDePago | null> {
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
