/**
 * apps/api · ATRIBUCIÓN FIRST-PARTY · esquema y repositorio.
 *
 * UNA FILA POR INTENCIÓN, y la base lo impone: la clave primaria es `(organization_id, ref)`. El `ref` lo
 * genera el sitio en el mismo gesto del clic, así que dos ingestas del mismo evento, un reintento o un
 * redespliegue no pueden producir dos atribuciones. No se confía en que el código recuerde comprobarlo.
 *
 * LO QUE **NO** SE GUARDA AQUÍ, y es la mitad del diseño: teléfono, nombre, correo, dirección IP,
 * `user-agent`, el texto del mensaje de WhatsApp ni ningún identificador de persona. Lo que se guarda es de
 * qué anuncio vino un clic. Nada de esto se envía a Google: es la base de SOEC, y sirve para evaluar el
 * piloto, no para que nadie puje por ello.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { AtribucionDeIntencion, EstadoAtribucion } from './atribucion-tipos';

export type Queryable = Pool | PoolClient;

export const atribucionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_atribucion_first_party',
    sql: `
      create table if not exists first_party_attribution (
        organization_id  text        not null,
        ref              text        not null,
        gclid            text,
        event_timestamp  timestamptz not null,
        estado           text        not null,
        campaign_id      text,
        campaign_name    text,
        ad_group_id      text,
        ad_group_name    text,
        keyword          text,
        match_type       text,
        device           text,
        click_date       date,
        resuelto_en      timestamptz,
        intentos         int         not null default 0,
        ultimo_error     text,
        creado_en        timestamptz not null default now(),
        primary key (organization_id, ref)
      );
      create index if not exists ix_fpa_org_estado on first_party_attribution (organization_id, estado);
      create index if not exists ix_fpa_org_evento on first_party_attribution (organization_id, event_timestamp desc);
    `,
  },
];

function aAtribucion(r: Record<string, unknown>): AtribucionDeIntencion {
  const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
  const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    organizationId: String(r.organization_id),
    ref: String(r.ref),
    gclid: texto(r.gclid),
    eventTimestamp: iso(r.event_timestamp) ?? '',
    estado: String(r.estado) as EstadoAtribucion,
    campaignId: texto(r.campaign_id),
    campaignName: texto(r.campaign_name),
    adGroupId: texto(r.ad_group_id),
    adGroupName: texto(r.ad_group_name),
    keyword: texto(r.keyword),
    matchType: texto(r.match_type),
    device: texto(r.device),
    clickDate: r.click_date instanceof Date ? r.click_date.toISOString().slice(0, 10) : texto(r.click_date),
    resueltoEn: iso(r.resuelto_en),
    intentos: Number(r.intentos ?? 0),
    ultimoError: texto(r.ultimo_error),
  };
}

export class RepositorioAtribucion {
  constructor(private readonly pool: Pool) {}

  /**
   * Registra la intención si es nueva. Devuelve `true` sólo la primera vez: es la comprobación de
   * idempotencia, y la hace la base con `on conflict do nothing`, no una lectura previa que podría cruzarse
   * con otra petición.
   */
  async registrarSiNueva(a: Pick<AtribucionDeIntencion, 'organizationId' | 'ref' | 'gclid' | 'eventTimestamp'>): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `insert into first_party_attribution (organization_id, ref, gclid, event_timestamp, estado)
       values ($1,$2,$3,$4,'PENDIENTE')
       on conflict (organization_id, ref) do nothing`,
      [a.organizationId, a.ref, a.gclid, a.eventTimestamp],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Guarda el resultado de resolver una intención. Suma un intento SIEMPRE: los fallos también se cuentan. */
  async resolver(
    org: string,
    ref: string,
    r: {
      readonly estado: EstadoAtribucion;
      readonly campaignId?: string | null;
      readonly campaignName?: string | null;
      readonly adGroupId?: string | null;
      readonly adGroupName?: string | null;
      readonly keyword?: string | null;
      readonly matchType?: string | null;
      readonly device?: string | null;
      readonly clickDate?: string | null;
      readonly error?: string | null;
      readonly resueltoEn: string;
    },
  ): Promise<void> {
    await this.pool.query(
      `update first_party_attribution
          set estado = $3, campaign_id = $4, campaign_name = $5, ad_group_id = $6, ad_group_name = $7,
              keyword = $8, match_type = $9, device = $10, click_date = $11,
              resuelto_en = $12, intentos = intentos + 1, ultimo_error = $13
        where organization_id = $1 and ref = $2`,
      [org, ref, r.estado, r.campaignId ?? null, r.campaignName ?? null, r.adGroupId ?? null, r.adGroupName ?? null,
        r.keyword ?? null, r.matchType ?? null, r.device ?? null, r.clickDate ?? null, r.resueltoEn, r.error ?? null],
    );
  }

  async obtener(org: string, ref: string): Promise<AtribucionDeIntencion | null> {
    const { rows } = await this.pool.query('select * from first_party_attribution where organization_id = $1 and ref = $2', [org, ref]);
    return rows[0] ? aAtribucion(rows[0] as Record<string, unknown>) : null;
  }

  /** Intenciones que todavía no tienen respuesta definitiva de la plataforma. */
  async pendientes(org: string, limite = 50): Promise<readonly AtribucionDeIntencion[]> {
    const { rows } = await this.pool.query(
      `select * from first_party_attribution
        where organization_id = $1 and estado in ('PENDIENTE','PROVIDER_UNAVAILABLE')
        order by event_timestamp asc limit $2`,
      [org, limite],
    );
    return rows.map((r: Record<string, unknown>) => aAtribucion(r));
  }

  /**
   * SONDAS DE CAMPO. Comprobar en producción que el camino funciona exige mandar alguna intención que no es
   * de nadie. Se marcan con este prefijo y quedan FUERA de las cifras del piloto: una sonda mía contada como
   * intención sería exactamente el tipo de dato inventado que este sistema existe para no producir.
   *
   * Siguen guardadas —borrarlas escondería lo que se hizo— pero no se mezclan con lo real.
   */
  private static readonly PREFIJO_DE_PRUEBA = 'PROBE-';

  /**
   * Resumen del piloto: cuántas intenciones hay por estado y cuántas se atribuyeron a cada campaña. Es lo
   * único que se puede afirmar con esta medición — y se afirma sobre lo guardado, no sobre una estimación.
   * Las sondas de campo no entran: no son intenciones de nadie.
   */
  async resumen(org: string): Promise<{
    readonly porEstado: Readonly<Record<string, number>>;
    /** Cuántas sondas de campo hay guardadas. Se declara para que nadie las eche de menos ni las cuente. */
    readonly sondasDePrueba: number;
    readonly porCampana: ReadonlyArray<{ readonly campaignId: string; readonly campaignName: string | null; readonly intenciones: number }>;
  }> {
    const patron = `${RepositorioAtribucion.PREFIJO_DE_PRUEBA}%`;
    const estados = await this.pool.query(
      'select estado, count(*)::int as n from first_party_attribution where organization_id = $1 and ref not like $2 group by estado',
      [org, patron],
    );
    const campanas = await this.pool.query(
      `select campaign_id, max(campaign_name) as campaign_name, count(*)::int as n
         from first_party_attribution
        where organization_id = $1 and estado = 'ATTRIBUTED' and campaign_id is not null and ref not like $2
        group by campaign_id order by n desc`,
      [org, patron],
    );
    const sondas = await this.pool.query(
      'select count(*)::int as n from first_party_attribution where organization_id = $1 and ref like $2',
      [org, patron],
    );
    return {
      sondasDePrueba: Number((sondas.rows[0] as { n: number } | undefined)?.n ?? 0),
      porEstado: Object.fromEntries(estados.rows.map((r: { estado: string; n: number }) => [r.estado, Number(r.n)])),
      porCampana: campanas.rows.map((r: { campaign_id: string; campaign_name: string | null; n: number }) => ({
        campaignId: String(r.campaign_id),
        campaignName: r.campaign_name === null ? null : String(r.campaign_name),
        intenciones: Number(r.n),
      })),
    };
  }
}
