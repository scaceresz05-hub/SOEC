/**
 * apps/api · PROVISIONAMIENTO · persistencia de la SOLICITUD.
 *
 * Una solicitud de alta de cuenta no es un formulario: es una operación externa que, si se repite a ciegas,
 * deja dos cuentas de anuncios en la vida real de alguien. Por eso vive en una tabla, con una regla dura en el
 * índice —**una sola solicitud activa por empresa y proveedor**— y con un estado explícito para el caso que
 * más daño hace: la respuesta que nunca llegó.
 *
 * Aquí no se guarda ningún secreto: ni tokens, ni credenciales, ni datos de tarjeta. El nombre, la moneda y la
 * zona horaria salen del negocio; la referencia del proveedor es un identificador opaco.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { EstadoCapacidad, EstadoSolicitud, MotivoCapacidad, SolicitudProvisionamiento } from './provisionamiento-tipos';

type Queryable = Pool | PoolClient;

export const provisionamientoMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_account_provisioning_request',
    sql: `
      create table if not exists account_provisioning_request (
        id                    text primary key,
        organization_id       text not null,
        proveedor             text not null,
        nombre_deseado        text not null,
        moneda                text not null,
        zona_horaria          text not null,
        capacidad             text not null,
        motivo                text not null,
        referencia_proveedor  text,
        estado                text not null,
        detalle               text,
        creado_en             timestamptz not null default now(),
        actualizado_en        timestamptz not null default now(),
        completado_en         timestamptz
      );
      create index if not exists account_provisioning_org_idx on account_provisioning_request (organization_id, estado);
      -- UNA solicitud activa por empresa y proveedor. Que dos intentos no puedan coexistir es la diferencia
      -- entre una cuenta y dos cuentas: esto se impone en la base, no en el cuidado de quien llame.
      create unique index if not exists account_provisioning_activa_uniq
        on account_provisioning_request (organization_id, proveedor)
        where estado in ('PENDING', 'READY', 'EXECUTING', 'WAITING_HUMAN', 'RETRY_LATER');
    `,
  },
];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const isoNulo = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function aSolicitud(r: Record<string, unknown>): SolicitudProvisionamiento {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    proveedor: String(r.proveedor) as 'GOOGLE_ADS',
    nombreDeseado: String(r.nombre_deseado),
    moneda: String(r.moneda),
    zonaHoraria: String(r.zona_horaria),
    capacidad: String(r.capacidad) as EstadoCapacidad,
    motivo: String(r.motivo) as MotivoCapacidad,
    referenciaProveedor: texto(r.referencia_proveedor),
    estado: String(r.estado) as EstadoSolicitud,
    detalle: texto(r.detalle),
    creadoEn: iso(r.creado_en),
    actualizadoEn: iso(r.actualizado_en),
    completadoEn: isoNulo(r.completado_en),
  };
}

export class RepositorioProvisionamiento {
  constructor(private readonly pool: Pool) {}

  /** La solicitud viva de esta empresa, si la hay. Sólo una puede estarlo. */
  async activa(org: string, proveedor = 'GOOGLE_ADS'): Promise<SolicitudProvisionamiento | null> {
    const { rows } = await this.pool.query(
      `select * from account_provisioning_request
        where organization_id = $1 and proveedor = $2
          and estado in ('PENDING','READY','EXECUTING','WAITING_HUMAN','RETRY_LATER')
        limit 1`,
      [org, proveedor],
    );
    return rows[0] ? aSolicitud(rows[0] as Record<string, unknown>) : null;
  }

  /**
   * Inserta la solicitud si no hay ninguna activa; si ya la hay, devuelve ESA. El llamador nunca tiene que
   * preguntarse cuál de dos ganó, porque sólo puede haber una.
   */
  async abrirSiFalta(q: Queryable, s: SolicitudProvisionamiento): Promise<SolicitudProvisionamiento> {
    const { rows } = await q.query(
      `insert into account_provisioning_request (id, organization_id, proveedor, nombre_deseado, moneda,
         zona_horaria, capacidad, motivo, referencia_proveedor, estado, detalle, creado_en, actualizado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
       on conflict do nothing
       returning *`,
      [s.id, s.organizationId, s.proveedor, s.nombreDeseado, s.moneda, s.zonaHoraria, s.capacidad, s.motivo,
        s.referenciaProveedor, s.estado, s.detalle],
    );
    if (rows.length > 0) return aSolicitud(rows[0] as Record<string, unknown>);

    const { rows: previas } = await q.query(
      `select * from account_provisioning_request
        where organization_id = $1 and proveedor = $2
          and estado in ('PENDING','READY','EXECUTING','WAITING_HUMAN','RETRY_LATER')
        limit 1`,
      [s.organizationId, s.proveedor],
    );
    return aSolicitud(previas[0] as Record<string, unknown>);
  }

  /**
   * Cambia el estado. `actualizado_en` sólo se mueve si algo cambió de verdad: un reintento que concluye lo
   * mismo que el anterior no debe parecer un hecho nuevo cuando alguien lea la fila mañana.
   */
  async cambiar(q: Queryable, org: string, id: string, cambios: {
    readonly estado?: EstadoSolicitud;
    readonly capacidad?: EstadoCapacidad;
    readonly motivo?: MotivoCapacidad;
    readonly referenciaProveedor?: string | null;
    readonly detalle?: string | null;
  }): Promise<SolicitudProvisionamiento | null> {
    const { rows } = await q.query(
      `update account_provisioning_request
          set estado   = coalesce($3, estado),
              capacidad = coalesce($4, capacidad),
              motivo   = coalesce($5, motivo),
              referencia_proveedor = coalesce($6, referencia_proveedor),
              detalle  = coalesce($7, detalle),
              completado_en = case when coalesce($3, estado) = 'COMPLETED' then now() else completado_en end,
              actualizado_en = now()
        where organization_id = $1 and id = $2
          and (estado is distinct from coalesce($3, estado)
               or capacidad is distinct from coalesce($4, capacidad)
               or motivo is distinct from coalesce($5, motivo)
               or referencia_proveedor is distinct from coalesce($6, referencia_proveedor)
               or detalle is distinct from coalesce($7, detalle))
        returning *`,
      [org, id, cambios.estado ?? null, cambios.capacidad ?? null, cambios.motivo ?? null,
        cambios.referenciaProveedor ?? null, cambios.detalle ?? null],
    );
    if (rows.length > 0) return aSolicitud(rows[0] as Record<string, unknown>);
    return this.porId(org, id); // nada cambió: se devuelve la que está, intacta
  }

  async porId(org: string, id: string): Promise<SolicitudProvisionamiento | null> {
    const { rows } = await this.pool.query(
      'select * from account_provisioning_request where organization_id = $1 and id = $2', [org, id],
    );
    return rows[0] ? aSolicitud(rows[0] as Record<string, unknown>) : null;
  }

  async historial(org: string, limite = 50): Promise<readonly SolicitudProvisionamiento[]> {
    const { rows } = await this.pool.query(
      'select * from account_provisioning_request where organization_id = $1 order by creado_en desc limit $2',
      [org, limite],
    );
    return rows.map((r: Record<string, unknown>) => aSolicitud(r));
  }
}
