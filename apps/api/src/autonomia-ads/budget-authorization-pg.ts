/**
 * apps/api · Autorización de PRESUPUESTO TOTAL por HUMANO (P0, tenant+campaña). Representa el tope que un
 * humano autorizó a gastar — NO el presupuesto diario que Google fija. Sólo lectura/escritura de metadatos;
 * SOEC nunca ejecuta gasto.
 *
 * VERDAD (Objetivo 3): NO se registra retroactivamente ninguna autorización histórica. Para SmileFlow hoy la
 * tabla está VACÍA ⇒ `obtenerVigente` devuelve null ⇒ el guardrail informa "no había cap total autorizado".
 * Una autorización futura se crea explícitamente cuando el humano decida (aquí no se crea ninguna).
 */

import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';

export type EstadoAutorizacion = 'ACTIVE' | 'REVOKED';

export interface BudgetAuthorization {
  readonly organizationId: string;
  readonly provider: 'google-ads';
  readonly campaignId: string;
  readonly authorizedTotalAmount: number; // tope TOTAL autorizado por el humano (moneda `currency`)
  readonly currency: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly status: EstadoAutorizacion;
}

export const budgetAuthorizationMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_google_ads_budget_authorization',
    sql: `
      create table if not exists google_ads_budget_authorization (
        organization_id        text not null,
        provider               text not null default 'google-ads',
        campaign_id            text not null,
        authorized_total_amount numeric not null,
        currency               text not null,
        period_start           timestamptz,
        period_end             timestamptz,
        created_by             text not null,
        created_at             timestamptz not null default now(),
        status                 text not null default 'ACTIVE',
        primary key (organization_id, provider, campaign_id)
      );
      create index if not exists google_ads_budget_auth_org_idx on google_ads_budget_authorization (organization_id);
    `,
  },
];

function aIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class PgBudgetAuthorizationRepo {
  constructor(private readonly pool: Pool) {}

  /** Autorización VIGENTE (ACTIVE) para una campaña de un tenant, o null si no hay ninguna registrada. */
  async obtenerVigente(organizationId: string, campaignId: string, provider = 'google-ads'): Promise<BudgetAuthorization | null> {
    const r = await this.pool.query(
      `select * from google_ads_budget_authorization
       where organization_id = $1 and provider = $2 and campaign_id = $3 and status = 'ACTIVE'`,
      [organizationId, provider, campaignId],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      organizationId: String(row.organization_id),
      provider: 'google-ads',
      campaignId: String(row.campaign_id),
      authorizedTotalAmount: Number(row.authorized_total_amount),
      currency: String(row.currency),
      periodStart: aIso(row.period_start),
      periodEnd: aIso(row.period_end),
      createdBy: String(row.created_by),
      createdAt: aIso(row.created_at)!,
      status: String(row.status) as EstadoAutorizacion,
    };
  }

  /** Registra/actualiza una autorización (acto humano explícito). Tenant+campaña scoped. */
  async guardar(a: BudgetAuthorization): Promise<void> {
    await this.pool.query(
      `insert into google_ads_budget_authorization
         (organization_id, provider, campaign_id, authorized_total_amount, currency, period_start, period_end, created_by, created_at, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, provider, campaign_id) do update set
         authorized_total_amount = excluded.authorized_total_amount, currency = excluded.currency,
         period_start = excluded.period_start, period_end = excluded.period_end,
         created_by = excluded.created_by, created_at = excluded.created_at, status = excluded.status`,
      [a.organizationId, a.provider, a.campaignId, a.authorizedTotalAmount, a.currency, a.periodStart, a.periodEnd, a.createdBy, a.createdAt, a.status],
    );
  }
}
