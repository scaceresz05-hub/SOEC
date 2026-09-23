/**
 * apps/api · HANDOFF EXTERNO · persistencia.
 *
 * Una tabla, multiempresa, con una regla dura en el índice: **no puede haber dos tareas abiertas para la
 * misma empresa, el mismo canal, el mismo tipo y la misma causa**. La idempotencia no se implementa «con
 * cuidado» en el servicio: se impone en la base, que es donde las carreras se pierden o se ganan.
 *
 * Cuando una tarea se completa y la condición vuelve a aparecer, se crea una instancia NUEVA. El historial es
 * parte del valor: saber que una cuenta se configuró, se rompió y se volvió a configurar dice algo.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { CanalHandoff, EstadoHandoff, Handoff, TipoHandoff } from './handoff-tipos';

type Queryable = Pool | PoolClient;

export const handoffMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_external_handoff',
    sql: `
      create table if not exists external_handoff (
        id                    text primary key,
        organization_id       text not null,
        canal                 text not null,
        tipo                  text not null,
        estado                text not null,
        causa                 text not null,
        instruccion           text not null,
        motivo                text not null,
        url_proveedor         text,
        etiqueta_accion       text not null,
        referencia_proveedor  text,
        metadata              jsonb not null default '{}'::jsonb,
        creado_en             timestamptz not null default now(),
        actualizado_en        timestamptz not null default now(),
        expira_en             timestamptz,
        completado_en         timestamptz
      );
      create index if not exists external_handoff_org_idx on external_handoff (organization_id, estado);
      -- UNA tarea abierta por causa. Reabrir después de completada crea otra fila, y eso es historia, no ruido.
      create unique index if not exists external_handoff_abierta_uniq
        on external_handoff (organization_id, canal, tipo, causa)
        where estado in ('OPEN', 'WAITING_EXTERNAL', 'BLOCKED_EXTERNAL');
    `,
  },
];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const isoNulo = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

function aHandoff(r: Record<string, unknown>): Handoff {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    canal: String(r.canal) as CanalHandoff,
    tipo: String(r.tipo) as TipoHandoff,
    estado: String(r.estado) as EstadoHandoff,
    causa: String(r.causa),
    instruccion: String(r.instruccion),
    motivo: String(r.motivo),
    urlProveedor: r.url_proveedor === null || r.url_proveedor === undefined ? null : String(r.url_proveedor),
    etiquetaAccion: String(r.etiqueta_accion),
    referenciaProveedor: r.referencia_proveedor === null || r.referencia_proveedor === undefined ? null : String(r.referencia_proveedor),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    creadoEn: iso(r.creado_en),
    actualizadoEn: iso(r.actualizado_en),
    expiraEn: isoNulo(r.expira_en),
    completadoEn: isoNulo(r.completado_en),
  };
}

export class RepositorioHandoff {
  constructor(private readonly pool: Pool) {}

  /**
   * Inserta la tarea si no hay ya una ABIERTA con la misma causa. Devuelve la fila que queda vigente —la
   * nueva o la que ya estaba—, de modo que el llamador nunca tiene que preguntarse cuál de las dos ganó.
   */
  async abrirSiFalta(q: Queryable, h: Handoff): Promise<Handoff> {
    const { rows } = await q.query(
      `insert into external_handoff (id, organization_id, canal, tipo, estado, causa, instruccion, motivo,
         url_proveedor, etiqueta_accion, referencia_proveedor, metadata, creado_en, actualizado_en, expira_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, now(), now(), $13)
       on conflict do nothing
       returning *`,
      [h.id, h.organizationId, h.canal, h.tipo, h.estado, h.causa, h.instruccion, h.motivo,
        h.urlProveedor, h.etiquetaAccion, h.referenciaProveedor, JSON.stringify(h.metadata), h.expiraEn],
    );
    if (rows.length > 0) return aHandoff(rows[0] as Record<string, unknown>);

    // Ya había una abierta con esta causa: se refresca su redacción (el motivo puede haber mejorado) y se
    // devuelve. Nunca se duplica ni se reinicia su historia.
    const { rows: previas } = await q.query(
      `update external_handoff
          set instruccion = $5, motivo = $6, url_proveedor = $7, etiqueta_accion = $8, actualizado_en = now()
        where organization_id = $1 and canal = $2 and tipo = $3 and causa = $4
          and estado in ('OPEN','WAITING_EXTERNAL','BLOCKED_EXTERNAL')
        returning *`,
      [h.organizationId, h.canal, h.tipo, h.causa, h.instruccion, h.motivo, h.urlProveedor, h.etiquetaAccion],
    );
    return aHandoff(previas[0] as Record<string, unknown>);
  }

  async cambiarEstado(q: Queryable, org: string, id: string, estado: EstadoHandoff, detalle?: { readonly referenciaProveedor?: string | null }): Promise<Handoff | null> {
    const { rows } = await q.query(
      `update external_handoff
          set estado = $3,
              completado_en = case when $3 = 'COMPLETED' then now() else completado_en end,
              referencia_proveedor = coalesce($4, referencia_proveedor),
              actualizado_en = now()
        where organization_id = $1 and id = $2
        returning *`,
      [org, id, estado, detalle?.referenciaProveedor ?? null],
    );
    return rows[0] ? aHandoff(rows[0] as Record<string, unknown>) : null;
  }

  /** Cierra como CANCELLED las tareas abiertas de un canal que ya no tienen sentido. */
  async cancelarAbiertas(q: Queryable, org: string, canal: CanalHandoff, tipos: readonly TipoHandoff[]): Promise<number> {
    if (tipos.length === 0) return 0;
    const { rowCount } = await q.query(
      `update external_handoff set estado = 'CANCELLED', actualizado_en = now()
        where organization_id = $1 and canal = $2 and tipo = any($3::text[])
          and estado in ('OPEN','WAITING_EXTERNAL','BLOCKED_EXTERNAL')`,
      [org, canal, tipos],
    );
    return rowCount ?? 0;
  }

  /** Marca como vencidas las que pasaron su fecha. Una tarea vencida vuelve a abrirse si la causa sigue. */
  async vencerCaducadas(q: Queryable, org: string): Promise<number> {
    const { rowCount } = await q.query(
      `update external_handoff set estado = 'EXPIRED', actualizado_en = now()
        where organization_id = $1 and expira_en is not null and expira_en < now()
          and estado in ('OPEN','WAITING_EXTERNAL','BLOCKED_EXTERNAL')`,
      [org],
    );
    return rowCount ?? 0;
  }

  async abiertas(org: string): Promise<readonly Handoff[]> {
    const { rows } = await this.pool.query(
      `select * from external_handoff
        where organization_id = $1 and estado in ('OPEN','WAITING_EXTERNAL','BLOCKED_EXTERNAL')
        order by creado_en`,
      [org],
    );
    return rows.map((r: Record<string, unknown>) => aHandoff(r));
  }

  async historial(org: string, limite = 50): Promise<readonly Handoff[]> {
    const { rows } = await this.pool.query(
      'select * from external_handoff where organization_id = $1 order by creado_en desc limit $2', [org, limite],
    );
    return rows.map((r: Record<string, unknown>) => aHandoff(r));
  }

  /** Una tarea concreta DE ESTA EMPRESA. El filtro por organización no es opcional en ninguna consulta. */
  async porId(org: string, id: string): Promise<Handoff | null> {
    const { rows } = await this.pool.query('select * from external_handoff where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aHandoff(rows[0] as Record<string, unknown>) : null;
  }
}
