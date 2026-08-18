/**
 * apps/api · Meta DATA DELETION CALLBACK (público, requisito de App Review).
 *
 * Meta envía POST con `signed_request` (base64url `<sig>.<payload>`, sig = HMAC-SHA256(payload, appSecret)).
 * Verificamos la firma, registramos una solicitud de borrado con un `confirmation_code`, y respondemos
 * `{ url, confirmation_code }` según el contrato de Meta. El purgado efectivo de los datos de esa conexión
 * (token secretRef + snapshots read-only; SOEC no guarda PII de usuarios finales) se marca para procesamiento.
 * Endpoint público: llega sin sesión y se autentica por la firma del app secret.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';

export const dataDeletionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_meta_data_deletion_init',
    sql: `
      create table if not exists meta_data_deletion_request (
        confirmation_code text primary key,
        external_user_id  text,
        estado            text not null default 'RECIBIDA',
        created_at        timestamptz not null default now(),
        processed_at      timestamptz
      );
    `,
  },
];

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface SignedRequest {
  readonly userId: string | null;
  readonly valido: boolean;
}

/** Verifica y parsea el signed_request de Meta. Firma inválida ⇒ {valido:false}. */
export function parseSignedRequest(signed: string, appSecret: string): SignedRequest {
  const partes = signed.split('.');
  if (partes.length !== 2) return { userId: null, valido: false };
  const [sig, payload] = partes as [string, string];
  const esperado = createHmac('sha256', appSecret).update(payload).digest();
  const recibido = b64urlDecode(sig);
  const valido = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  if (!valido) return { userId: null, valido: false };
  try {
    const data = JSON.parse(b64urlDecode(payload).toString('utf8')) as { user_id?: string };
    return { userId: data.user_id ?? null, valido: true };
  } catch {
    return { userId: null, valido: false };
  }
}

export interface DepsDataDeletion {
  readonly pool: Pool | undefined;
  readonly appSecret: string | undefined;
  readonly webBaseUrl: string | undefined;
}

export function registerMetaDataDeletionPublico(app: FastifyInstance, deps: DepsDataDeletion): void {
  const base = deps.webBaseUrl ?? '';

  app.post('/meta/data-deletion', async (req, reply) => {
    const body = (req.body ?? {}) as { signed_request?: string };
    const firmado = body.signed_request;
    if (!firmado || !deps.appSecret) return reply.code(400).send({ error: 'signed_request requerido' });
    const parsed = parseSignedRequest(firmado, deps.appSecret);
    if (!parsed.valido) return reply.code(400).send({ error: 'firma inválida' });

    const confirmationCode = randomUUID().replace(/-/g, '');
    if (deps.pool) {
      await deps.pool.query('insert into meta_data_deletion_request (confirmation_code, external_user_id) values ($1,$2) on conflict do nothing', [confirmationCode, parsed.userId]);
    }
    // Contrato Meta: devolver url de seguimiento + confirmation_code.
    return reply.send({ url: `${base}/eliminacion-datos/estado?code=${confirmationCode}`, confirmation_code: confirmationCode });
  });

  app.get('/meta/data-deletion/estado', async (req, reply) => {
    const { code } = (req.query ?? {}) as { code?: string };
    if (!code) return reply.code(400).send({ ok: false, error: 'code requerido' });
    if (!deps.pool) return reply.send({ ok: true, datos: { estado: 'RECIBIDA' } });
    const r = await deps.pool.query('select estado, created_at, processed_at from meta_data_deletion_request where confirmation_code=$1', [code]);
    if (!r.rows[0]) return reply.code(404).send({ ok: false, error: 'no encontrado' });
    const x = r.rows[0] as { estado: string; created_at: Date; processed_at: Date | null };
    return reply.send({ ok: true, datos: { estado: x.estado, recibidaEn: x.created_at.toISOString(), procesadaEn: x.processed_at ? x.processed_at.toISOString() : null } });
  });
}
