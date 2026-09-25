/**
 * apps/api · VERIFICACIÓN DEL ANUNCIANTE · persistencia.
 *
 * Dos tablas pequeñas y una idea en cada una.
 *
 * `verification_observability` recuerda algo que Google ya nos dijo y no va a cambiar solo: que en ESTA
 * cuenta no puede consultarse la verificación. Es una propiedad del régimen de facturación, no un fallo
 * pasajero, así que preguntarlo cada cinco minutos sería gastar cuota de una llamada que Google limita
 * especialmente para recibir siempre el mismo 400.
 *
 * `verification_attestation` guarda lo que una persona AFIRMA: que completó en Google lo que Google le pidió.
 * El nombre de todo lo que hay aquí evita decir «verificado» o «aprobado», porque no lo sabemos: lo sabe
 * Google y no nos lo cuenta. Nadie guarda documentos, ni RUT, ni identidades, ni respuestas legales — no se
 * piden, no se transmiten y no caben en este esquema.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';

type Queryable = Pool | PoolClient;

/** Qué sabemos sobre la POSIBILIDAD de consultar la verificación en una cuenta. */
export type ObservabilidadVerificacion = 'OBSERVABLE' | 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE';

export const verificacionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_verification_observability_y_attestation',
    sql: `
      create table if not exists verification_observability (
        organization_id  text not null,
        proveedor        text not null,
        customer_id      text not null,
        observabilidad   text not null,
        detalle          text,
        detectado_en     timestamptz not null default now(),
        primary key (organization_id, proveedor, customer_id)
      );

      create table if not exists verification_attestation (
        id                       text primary key,
        organization_id          text not null,
        proveedor                text not null,
        customer_id              text not null,
        actor                    text not null,
        confirmado_por_persona_en timestamptz not null default now()
      );
      -- UNA confirmación por empresa, proveedor y CUENTA: cambiar de cuenta deja la anterior sin efecto.
      create unique index if not exists verification_attestation_uniq
        on verification_attestation (organization_id, proveedor, customer_id);
    `,
  },
];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export interface ConfirmacionDeVerificacion {
  readonly id: string;
  readonly organizationId: string;
  readonly proveedor: 'GOOGLE_ADS';
  readonly customerId: string;
  readonly actor: string;
  /**
   * Cuándo lo confirmó la persona. El nombre dice quién lo afirma: no es la fecha en que Google verificó
   * nada, porque Google no nos lo ha dicho.
   */
  readonly confirmadoPorPersonaEn: string;
}

export class RepositorioObservabilidadVerificacion {
  constructor(private readonly pool: Pool) {}

  async de(org: string, customerId: string | null, proveedor = 'GOOGLE_ADS'): Promise<ObservabilidadVerificacion | null> {
    if (customerId === null || customerId.trim() === '') return null;
    const { rows } = await this.pool.query(
      'select observabilidad from verification_observability where organization_id = $1 and proveedor = $2 and customer_id = $3',
      [org, proveedor, customerId],
    );
    return rows[0] ? (String(rows[0].observabilidad) as ObservabilidadVerificacion) : null;
  }

  /** Se registra una vez y se respeta. Repetirlo no cambia la fecha: no es un hecho nuevo cada tick. */
  async registrar(q: Queryable, org: string, customerId: string, observabilidad: ObservabilidadVerificacion, detalle: string | null, proveedor = 'GOOGLE_ADS'): Promise<void> {
    await q.query(
      `insert into verification_observability (organization_id, proveedor, customer_id, observabilidad, detalle)
       values ($1,$2,$3,$4,$5)
       on conflict (organization_id, proveedor, customer_id) do update
         set observabilidad = excluded.observabilidad,
             detalle = excluded.detalle
         where verification_observability.observabilidad is distinct from excluded.observabilidad`,
      [org, proveedor, customerId, observabilidad, detalle],
    );
  }
}

export class RepositorioConfirmacionDeVerificacion {
  constructor(private readonly pool: Pool) {}

  async vigente(org: string, customerId: string | null, proveedor = 'GOOGLE_ADS'): Promise<ConfirmacionDeVerificacion | null> {
    if (customerId === null || customerId.trim() === '') return null;
    const { rows } = await this.pool.query(
      'select * from verification_attestation where organization_id = $1 and proveedor = $2 and customer_id = $3',
      [org, proveedor, customerId],
    );
    const r = rows[0] as Record<string, unknown> | undefined;
    return r === undefined ? null : {
      id: String(r.id), organizationId: String(r.organization_id), proveedor: String(r.proveedor) as 'GOOGLE_ADS',
      customerId: String(r.customer_id), actor: String(r.actor),
      confirmadoPorPersonaEn: iso(r.confirmado_por_persona_en),
    };
  }

  async registrar(q: Queryable, c: ConfirmacionDeVerificacion): Promise<ConfirmacionDeVerificacion> {
    const { rows } = await q.query(
      `insert into verification_attestation (id, organization_id, proveedor, customer_id, actor, confirmado_por_persona_en)
       values ($1,$2,$3,$4,$5, now())
       on conflict (organization_id, proveedor, customer_id)
         do update set actor = excluded.actor, confirmado_por_persona_en = now()
       returning *`,
      [c.id, c.organizationId, c.proveedor, c.customerId, c.actor],
    );
    const r = rows[0] as Record<string, unknown>;
    return {
      id: String(r.id), organizationId: String(r.organization_id), proveedor: String(r.proveedor) as 'GOOGLE_ADS',
      customerId: String(r.customer_id), actor: String(r.actor),
      confirmadoPorPersonaEn: iso(r.confirmado_por_persona_en),
    };
  }
}
