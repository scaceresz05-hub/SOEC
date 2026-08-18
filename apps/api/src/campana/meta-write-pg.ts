/**
 * apps/api · V2 PRE-REAL · Persistencia PostgreSQL de la RECONCILIATION del write path real. Tenant-scoped,
 * `meta_write_reconciliation`. La reserva es atómica (insert on conflict do nothing) ⇒ dos ejecuciones
 * concurrentes con la misma idempotencyKey no pueden ambas crear la campaña/ad.
 */
import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { AsientoReconciliacion, EstadoReconciliacion, ReconciliacionRepo } from './meta-write-reconciliation';

export const metaWriteMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_meta_write_reconciliation_init',
    sql: `
      create table if not exists meta_write_reconciliation (
        organization_id  text not null,
        idempotency_key  text not null,
        operacion        text not null,
        estado           text not null,
        external_ref     text,
        created_at       timestamptz not null default now(),
        updated_at       timestamptz not null default now(),
        primary key (organization_id, idempotency_key)
      );
    `,
  },
];

function map(x: Record<string, unknown>): AsientoReconciliacion {
  return { organizationId: String(x['organization_id']), idempotencyKey: String(x['idempotency_key']), operacion: String(x['operacion']), estado: String(x['estado']) as EstadoReconciliacion, externalRef: x['external_ref'] ? String(x['external_ref']) : null };
}

export class PgReconciliacionRepo implements ReconciliacionRepo {
  constructor(private readonly pool: Pool) {}
  async reservar(org: string, key: string, operacion: string): Promise<{ creado: boolean; previo: AsientoReconciliacion | null }> {
    const ins = await this.pool.query(
      `insert into meta_write_reconciliation (organization_id, idempotency_key, operacion, estado)
       values ($1,$2,$3,'PENDING') on conflict (organization_id, idempotency_key) do nothing returning *`,
      [org, key, operacion],
    );
    if ((ins.rowCount ?? 0) > 0) return { creado: true, previo: null };
    const prev = await this.obtener(org, key);
    return { creado: false, previo: prev };
  }
  async completar(org: string, key: string, externalRef: string): Promise<void> {
    await this.pool.query("update meta_write_reconciliation set estado='COMPLETED', external_ref=$3, updated_at=now() where organization_id=$1 and idempotency_key=$2", [org, key, externalRef]);
  }
  async marcar(org: string, key: string, estado: EstadoReconciliacion): Promise<void> {
    await this.pool.query('update meta_write_reconciliation set estado=$3, updated_at=now() where organization_id=$1 and idempotency_key=$2', [org, key, estado]);
  }
  async obtener(org: string, key: string): Promise<AsientoReconciliacion | null> {
    const r = await this.pool.query('select * from meta_write_reconciliation where organization_id=$1 and idempotency_key=$2', [org, key]);
    return r.rows[0] ? map(r.rows[0] as Record<string, unknown>) : null;
  }
}
