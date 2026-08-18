/**
 * apps/api · SAFE ACTION PLANE (V2-A) · Persistencia PostgreSQL. Tenant-scoped, `accion_*`.
 * Mandatos (tope duro de gasto) + Action Ledger append-only (idempotente). El techo/moneda/período del
 * mandato son inmutables por la máquina autónoma; sólo el endpoint humano los cambia (reautorización).
 */
import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { EstadoMandato, Mandato } from './mandato';
import type { ActionLedgerRepo, AsientoAccion, EstadoAsiento } from './ledger';

export const accionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_accion_init',
    sql: `
      create table if not exists accion_mandato (
        id                       text primary key,
        organization_id          text not null,
        objective                text not null,
        currency                 text not null,
        authorized_budget_minor  bigint not null,
        spent_minor              bigint not null default 0,
        period_start             timestamptz not null,
        period_end               timestamptz not null,
        allowed_meta_assets      jsonb not null default '[]'::jsonb,
        allowed_action_types     jsonb not null default '[]'::jsonb,
        status                   text not null,
        kill_switch              boolean not null default false,
        authorized_by            text not null,
        authorized_at            timestamptz,
        created_at               timestamptz not null,
        version                  int not null default 1
      );
      create index if not exists accion_mandato_org_idx on accion_mandato (organization_id);

      create table if not exists accion_ledger (
        id               text not null,
        organization_id  text not null,
        mandato_id       text not null,
        idempotency_key  text not null,
        action_type      text not null,
        asset_id         text not null,
        cost_minor       bigint not null,
        currency         text not null,
        estado           text not null,
        modo             text not null,
        bloqueos         jsonb not null default '[]'::jsonb,
        propuesta_por    text not null,
        decided_at       timestamptz not null,
        effect_ref       text,
        primary key (organization_id, idempotency_key)
      );
      create index if not exists accion_ledger_mandato_idx on accion_ledger (organization_id, mandato_id, decided_at);
    `,
  },
];

export interface MandatoRepo {
  guardar(m: Mandato): Promise<void>;
  obtener(organizationId: string, id: string): Promise<Mandato | null>;
  /** Mandato "vigente" de la org (el más reciente no revocado/expirado), si existe. */
  actual(organizationId: string): Promise<Mandato | null>;
  listar(organizationId: string): Promise<readonly Mandato[]>;
}

function mapMandato(r: Record<string, unknown>): Mandato {
  return {
    id: String(r['id']),
    organizationId: String(r['organization_id']),
    objective: String(r['objective']),
    currency: String(r['currency']),
    authorizedBudgetMinor: Number(r['authorized_budget_minor']),
    spentMinor: Number(r['spent_minor']),
    periodStart: (r['period_start'] as Date).toISOString(),
    periodEnd: (r['period_end'] as Date).toISOString(),
    allowedMetaAssets: Array.isArray(r['allowed_meta_assets']) ? (r['allowed_meta_assets'] as string[]) : [],
    allowedActionTypes: Array.isArray(r['allowed_action_types']) ? (r['allowed_action_types'] as string[]) : [],
    status: String(r['status']) as EstadoMandato,
    killSwitch: r['kill_switch'] === true,
    authorizedBy: String(r['authorized_by']),
    authorizedAt: r['authorized_at'] ? (r['authorized_at'] as Date).toISOString() : null,
    createdAt: (r['created_at'] as Date).toISOString(),
    version: Number(r['version']),
  };
}

export class PgMandatoRepo implements MandatoRepo {
  constructor(private readonly pool: Pool) {}
  async guardar(m: Mandato): Promise<void> {
    await this.pool.query(
      `insert into accion_mandato (id, organization_id, objective, currency, authorized_budget_minor, spent_minor, period_start, period_end, allowed_meta_assets, allowed_action_types, status, kill_switch, authorized_by, authorized_at, created_at, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (id) do update set spent_minor=excluded.spent_minor, authorized_budget_minor=excluded.authorized_budget_minor, period_end=excluded.period_end,
         allowed_meta_assets=excluded.allowed_meta_assets, allowed_action_types=excluded.allowed_action_types, status=excluded.status, kill_switch=excluded.kill_switch,
         authorized_by=excluded.authorized_by, authorized_at=excluded.authorized_at, version=excluded.version`,
      [m.id, m.organizationId, m.objective, m.currency, m.authorizedBudgetMinor, m.spentMinor, m.periodStart, m.periodEnd, JSON.stringify(m.allowedMetaAssets), JSON.stringify(m.allowedActionTypes), m.status, m.killSwitch, m.authorizedBy, m.authorizedAt, m.createdAt, m.version],
    );
  }
  async obtener(org: string, id: string): Promise<Mandato | null> {
    const r = await this.pool.query('select * from accion_mandato where organization_id=$1 and id=$2', [org, id]);
    return r.rows[0] ? mapMandato(r.rows[0] as Record<string, unknown>) : null;
  }
  async actual(org: string): Promise<Mandato | null> {
    const r = await this.pool.query("select * from accion_mandato where organization_id=$1 and status <> 'REVOKED' order by created_at desc limit 1", [org]);
    return r.rows[0] ? mapMandato(r.rows[0] as Record<string, unknown>) : null;
  }
  async listar(org: string): Promise<readonly Mandato[]> {
    const r = await this.pool.query('select * from accion_mandato where organization_id=$1 order by created_at desc', [org]);
    return r.rows.map((x) => mapMandato(x as Record<string, unknown>));
  }
}

export class PgActionLedgerRepo implements ActionLedgerRepo {
  constructor(private readonly pool: Pool) {}
  async registrarSiNuevo(a: AsientoAccion): Promise<boolean> {
    const r = await this.pool.query(
      `insert into accion_ledger (id, organization_id, mandato_id, idempotency_key, action_type, asset_id, cost_minor, currency, estado, modo, bloqueos, propuesta_por, decided_at, effect_ref)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (organization_id, idempotency_key) do nothing
       returning id`,
      [a.id, a.organizationId, a.mandatoId, a.idempotencyKey, a.actionType, a.assetId, a.costMinor, a.currency, a.estado, a.modo, JSON.stringify(a.bloqueos), a.propuestaPor, a.decidedAt, a.effectRef],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async obtener(org: string, key: string): Promise<AsientoAccion | null> {
    const r = await this.pool.query('select * from accion_ledger where organization_id=$1 and idempotency_key=$2', [org, key]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    if (!x) return null;
    return {
      id: String(x['id']), organizationId: String(x['organization_id']), mandatoId: String(x['mandato_id']), idempotencyKey: String(x['idempotency_key']),
      actionType: String(x['action_type']), assetId: String(x['asset_id']), costMinor: Number(x['cost_minor']), currency: String(x['currency']),
      estado: String(x['estado']) as EstadoAsiento, modo: String(x['modo']) as 'DRY_RUN' | 'REAL', bloqueos: Array.isArray(x['bloqueos']) ? (x['bloqueos'] as string[]) : [],
      propuestaPor: String(x['propuesta_por']), decidedAt: (x['decided_at'] as Date).toISOString(), effectRef: x['effect_ref'] ? String(x['effect_ref']) : null,
    };
  }
  async listar(org: string, mandatoId: string): Promise<readonly AsientoAccion[]> {
    const r = await this.pool.query('select * from accion_ledger where organization_id=$1 and mandato_id=$2 order by decided_at', [org, mandatoId]);
    return r.rows.map((x0) => {
      const x = x0 as Record<string, unknown>;
      return { id: String(x['id']), organizationId: String(x['organization_id']), mandatoId: String(x['mandato_id']), idempotencyKey: String(x['idempotency_key']), actionType: String(x['action_type']), assetId: String(x['asset_id']), costMinor: Number(x['cost_minor']), currency: String(x['currency']), estado: String(x['estado']) as EstadoAsiento, modo: String(x['modo']) as 'DRY_RUN' | 'REAL', bloqueos: Array.isArray(x['bloqueos']) ? (x['bloqueos'] as string[]) : [], propuestaPor: String(x['propuesta_por']), decidedAt: (x['decided_at'] as Date).toISOString(), effectRef: x['effect_ref'] ? String(x['effect_ref']) : null };
    });
  }
}

export function crearReposAccion(pool: Pool): { mandatoRepo: PgMandatoRepo; ledgerRepo: PgActionLedgerRepo } {
  return { mandatoRepo: new PgMandatoRepo(pool), ledgerRepo: new PgActionLedgerRepo(pool) };
}
