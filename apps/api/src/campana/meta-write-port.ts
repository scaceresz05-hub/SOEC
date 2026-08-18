/**
 * apps/api · V2-B · META WRITE PORT (frontera de escritura) + DRY-RUN adapter + whitelist explícita.
 *
 * NINGÚN módulo de inteligencia llama a Meta directamente. Toda escritura pasa antes por el Action Plane
 * (policy → budget guard → ledger). El adapter DRY-RUN NUNCA toca la red: simula respuestas deterministas
 * para certificar el flujo completo sin Meta real. Operaciones financieras peligrosas: DENY por diseño.
 */
import { createHash } from 'node:crypto';

export type OperacionMeta =
  | 'CREATE_CAMPAIGN'
  | 'CREATE_ADSET'
  | 'CREATE_AD'
  | 'UPLOAD_CREATIVE'
  | 'PUBLISH_INSTAGRAM'
  | 'PUBLISH_FACEBOOK'
  | 'PAUSE_CAMPAIGN'
  | 'RESUME_CAMPAIGN'
  | 'PAUSE_AD'
  | 'RESUME_AD';

/** Operaciones de escritura PERMITIDAS. Todo lo demás ⇒ DENY. */
export const OPERACIONES_META_PERMITIDAS: readonly OperacionMeta[] = [
  'CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_AD', 'UPLOAD_CREATIVE',
  'PUBLISH_INSTAGRAM', 'PUBLISH_FACEBOOK', 'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'PAUSE_AD', 'RESUME_AD',
];

/** Operaciones financieras que NUNCA existen como escritura de Meta (soberanía humana). */
export const OPERACIONES_FINANCIERAS_DENEGADAS = [
  'INCREASE_AUTHORIZED_BUDGET', 'RENEW_BUDGET', 'EXTEND_FINANCIAL_MANDATE', 'CHANGE_CURRENCY', 'CREATE_NEW_FINANCIAL_AUTHORIZATION', 'RAISE_CAP',
] as const;

export function operacionPermitida(op: string): op is OperacionMeta {
  return (OPERACIONES_META_PERMITIDAS as readonly string[]).includes(op) && !(OPERACIONES_FINANCIERAS_DENEGADAS as readonly string[]).includes(op);
}

export interface SolicitudEscrituraMeta {
  readonly operacion: string;
  readonly organizationId: string;
  readonly assetId: string; // id canónico del activo afectado
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>; // sanitizado; nunca token/secret/PII
  readonly mandateId?: string; // mandato bajo el que se autorizó (defensa en profundidad del adapter real)
  readonly guardApproved?: boolean; // el Action Plane (policy+budget guard+ledger) YA aprobó esta acción
}

export interface ResultadoEscrituraMeta {
  readonly ok: boolean;
  readonly modo: 'DRY_RUN' | 'REAL';
  readonly externalRef: string | null; // id externo (real) o simulado (dry-run)
  readonly operacion: string;
  readonly detalle: string;
  readonly denegada?: boolean;
}

export interface MetaWritePort {
  readonly esReal: boolean;
  ejecutar(s: SolicitudEscrituraMeta): Promise<ResultadoEscrituraMeta>;
}

/**
 * Adapter DRY-RUN: NUNCA hace red. Deniega operaciones no permitidas. Para operaciones válidas devuelve un
 * `externalRef` SIMULADO determinista (derivado de la idempotencyKey), permitiendo certificar idempotencia
 * y el flujo completo sin Meta real. `esReal=false` ⇒ META_WRITE_CALLS = 0.
 */
export class MetaWriteDryRunAdapter implements MetaWritePort {
  readonly esReal = false;
  async ejecutar(s: SolicitudEscrituraMeta): Promise<ResultadoEscrituraMeta> {
    if (!operacionPermitida(s.operacion)) {
      return { ok: false, modo: 'DRY_RUN', externalRef: null, operacion: s.operacion, detalle: 'operación no permitida (whitelist)', denegada: true };
    }
    const hash = createHash('sha256').update(`${s.organizationId}:${s.operacion}:${s.idempotencyKey}`).digest('hex').slice(0, 16);
    return { ok: true, modo: 'DRY_RUN', externalRef: `dryrun:${s.operacion.toLowerCase()}:${hash}`, operacion: s.operacion, detalle: 'simulado (sin escritura real en Meta)' };
  }
}
