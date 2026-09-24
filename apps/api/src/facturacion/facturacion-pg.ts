/**
 * apps/api · FACTURACIÓN · persistencia de la ATESTACIÓN HUMANA.
 *
 * Una fila aquí significa exactamente esto: «esta persona, este día, dijo que el pago de ESTA cuenta de
 * anuncios está configurado en Google». Nada más. No hay un número de tarjeta, ni los últimos cuatro
 * dígitos, ni un identificador del perfil de pagos, ni un token: no se piden, no se guardan y no se
 * transmiten. Lo que se guarda es quién lo dijo, cuándo y sobre qué cuenta.
 *
 * La cuenta forma parte de la clave a propósito. Cambiar de cuenta de anuncios no es un detalle: lo que
 * alguien confirmó sobre una cuenta no dice nada sobre otra, así que la confirmación anterior deja de valer
 * sola, sin que nadie tenga que acordarse de invalidarla.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { ConfirmacionDePago } from './facturacion-tipos';

type Queryable = Pool | PoolClient;

export const facturacionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_payment_attestation',
    sql: `
      create table if not exists payment_attestation (
        id               text primary key,
        organization_id  text not null,
        proveedor        text not null,
        customer_id      text not null,
        actor            text not null,
        confirmado_en    timestamptz not null default now()
      );
      -- UNA confirmación por empresa, proveedor y CUENTA. Repetirla no crea historia nueva: refresca la fecha.
      create unique index if not exists payment_attestation_uniq
        on payment_attestation (organization_id, proveedor, customer_id);
    `,
  },
];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

function aConfirmacion(r: Record<string, unknown>): ConfirmacionDePago {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    proveedor: String(r.proveedor) as 'GOOGLE_ADS',
    customerId: String(r.customer_id),
    actor: String(r.actor),
    confirmadoEn: iso(r.confirmado_en),
  };
}

export class RepositorioConfirmacionDePago {
  constructor(private readonly pool: Pool) {}

  /** ¿Hay confirmación vigente para ESTA cuenta? Sin cuenta elegida no puede haberla. */
  async vigente(org: string, customerId: string | null, proveedor = 'GOOGLE_ADS'): Promise<ConfirmacionDePago | null> {
    if (customerId === null || customerId.trim() === '') return null;
    const { rows } = await this.pool.query(
      'select * from payment_attestation where organization_id = $1 and proveedor = $2 and customer_id = $3',
      [org, proveedor, customerId],
    );
    return rows[0] ? aConfirmacion(rows[0] as Record<string, unknown>) : null;
  }

  /** Registra la confirmación. Idempotente por cuenta: confirmar dos veces no son dos hechos. */
  async registrar(q: Queryable, c: ConfirmacionDePago): Promise<ConfirmacionDePago> {
    const { rows } = await q.query(
      `insert into payment_attestation (id, organization_id, proveedor, customer_id, actor, confirmado_en)
       values ($1,$2,$3,$4,$5, now())
       on conflict (organization_id, proveedor, customer_id)
         do update set actor = excluded.actor, confirmado_en = now()
       returning *`,
      [c.id, c.organizationId, c.proveedor, c.customerId, c.actor],
    );
    return aConfirmacion(rows[0] as Record<string, unknown>);
  }

  async historial(org: string): Promise<readonly ConfirmacionDePago[]> {
    const { rows } = await this.pool.query(
      'select * from payment_attestation where organization_id = $1 order by confirmado_en desc', [org],
    );
    return rows.map((r: Record<string, unknown>) => aConfirmacion(r));
  }
}
