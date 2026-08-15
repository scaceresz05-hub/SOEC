/**
 * AcquisitionLead — un potencial cliente normalizado, provider-neutral y sin PII.
 *
 * Identidad = `organization + source + externalLeadId`. NUNCA email/teléfono como identidad primaria
 * (esos son PII y no deben viajar). Reutiliza el guardarraíl `contienePII` de `@soec/comercio` para
 * rechazar cualquier campo sensible, y la disciplina de `ProvenanciaReal` (provider + externalId +
 * marcador de test) del motor de medición. Un lead de test (`esTest`) jamás contamina métricas
 * comerciales ni aprendizaje.
 */

import { contienePII } from './pii';
import type { CanalAdquisicion } from './canal';
import type { EvidenciaAtribucion } from './atribucion';
import { ATRIBUCION_DESCONOCIDA } from './atribucion';

export type SenalCalidadLead =
  | 'UNKNOWN'
  | 'UNQUALIFIED'
  | 'QUALIFIED'
  | 'OPPORTUNITY'
  | 'CUSTOMER'
  | 'LOST';

export interface LeadAdquisicion {
  readonly organizationId: string;
  readonly source: string;
  readonly channel: CanalAdquisicion;
  readonly externalLeadId: string;
  readonly createdAt: string;
  readonly campaignRef: string | null;
  readonly creativeRef: string | null;
  readonly attribution: EvidenciaAtribucion;
  readonly qualification: SenalCalidadLead;
  readonly esTest: boolean;
}

export class LeadInvalidoError extends Error {
  constructor(readonly motivo: string) {
    super(`Lead de adquisición inválido: ${motivo}`);
    this.name = 'LeadInvalidoError';
  }
}

export interface LeadCrudo {
  readonly organizationId: string;
  readonly source: string;
  readonly channel: CanalAdquisicion;
  readonly externalLeadId: string;
  readonly createdAt: string;
  readonly campaignRef?: string | null;
  readonly creativeRef?: string | null;
  readonly attribution?: EvidenciaAtribucion;
  readonly qualification?: SenalCalidadLead;
  readonly esTest?: boolean;
  /** Campos adicionales que llegan del proveedor; se validan contra PII y NO se persisten. */
  readonly extra?: Record<string, unknown>;
}

/**
 * Normaliza un lead crudo aplicando las reglas duras:
 *   · exige organization, source y externalLeadId (identidad); rechaza si falta;
 *   · rechaza si `externalLeadId` parece un email/teléfono (identidad ≠ PII);
 *   · rechaza si el bloque `extra` contiene PII;
 *   · nunca copia PII al lead resultante.
 */
export function normalizarLead(crudo: LeadCrudo): LeadAdquisicion {
  if (!crudo.organizationId) throw new LeadInvalidoError('falta organizationId');
  if (!crudo.source) throw new LeadInvalidoError('falta source');
  if (!crudo.externalLeadId) throw new LeadInvalidoError('falta externalLeadId (la identidad no puede ser PII)');
  if (contienePII({ id: crudo.externalLeadId })) {
    throw new LeadInvalidoError('externalLeadId no puede ser un email/teléfono (PII)');
  }
  if (crudo.extra && contienePII(crudo.extra)) {
    throw new LeadInvalidoError('el lead contiene PII en campos adicionales');
  }
  return {
    organizationId: crudo.organizationId,
    source: crudo.source,
    channel: crudo.channel,
    externalLeadId: crudo.externalLeadId,
    createdAt: crudo.createdAt,
    campaignRef: crudo.campaignRef ?? null,
    creativeRef: crudo.creativeRef ?? null,
    attribution: crudo.attribution ?? ATRIBUCION_DESCONOCIDA,
    qualification: crudo.qualification ?? 'UNKNOWN',
    esTest: crudo.esTest ?? false,
  };
}

/** Identidad estable de un lead, tenant-scoped. No contiene PII. */
export function identidadLead(l: Pick<LeadAdquisicion, 'organizationId' | 'source' | 'externalLeadId'>): string {
  return `${l.organizationId}:${l.source}:${l.externalLeadId}`;
}

/** Un lead sólo cuenta como comercial si NO es de test. La exclusión es explícita. */
export function cuentaComoComercial(l: LeadAdquisicion): boolean {
  return !l.esTest;
}
