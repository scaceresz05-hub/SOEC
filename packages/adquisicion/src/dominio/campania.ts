/**
 * AcquisitionCampaign + DistributionGroup — la campaña provider-neutral y su tier de distribución.
 *
 * Extiende el modelo de `@soec/campanias` con el eje SHADOW/aprobación y con un `GrupoDistribucion`
 * (equivalente neutral al Ad Set de Meta / conjunto de anuncios) que hoy no existe. El adaptador de
 * cada proveedor traduce `GrupoDistribucion` a su estructura real; el dominio no menciona Meta.
 *
 * Invariante clave: el estado INTERNO de SOEC nunca se confunde con el estado externo del proveedor.
 * Una campaña en estado `SHADOW` crea CERO objetos externos por construcción; un presupuesto
 * propuesto no es un presupuesto autorizado.
 */

import type { ObjetivoComercial } from './objetivo';
import type { CanalAdquisicion } from './canal';

export type EstadoCampana =
  | 'DRAFT'
  | 'SHADOW'
  | 'READY_FOR_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ARCHIVED';

const TRANSICIONES: Record<EstadoCampana, readonly EstadoCampana[]> = {
  DRAFT: ['SHADOW', 'READY_FOR_APPROVAL', 'ARCHIVED'],
  SHADOW: ['READY_FOR_APPROVAL', 'DRAFT', 'ARCHIVED'],
  READY_FOR_APPROVAL: ['APPROVED', 'DRAFT', 'ARCHIVED'],
  APPROVED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'FAILED'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  FAILED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function transicionCampanaValida(desde: EstadoCampana, hacia: EstadoCampana): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Estados en los que NO debe existir ningún objeto externo en el proveedor. */
export function sinEfectoExterno(estado: EstadoCampana): boolean {
  return estado === 'DRAFT' || estado === 'SHADOW' || estado === 'READY_FOR_APPROVAL';
}

export interface PoliticaPresupuesto {
  readonly moneda: string;
  /** Presupuesto PROPUESTO por SOEC; no autoriza gasto por sí solo. */
  readonly propuestoDiario: number | null;
  readonly propuestoTotal: number | null;
}

export interface PoliticaAudiencia {
  readonly descriptor: string;
  /** Segmentaciones permitidas (declaradas); nunca PII individual. */
  readonly segmentacionesPermitidas: readonly string[];
}

/**
 * GrupoDistribucion — tier intermedio (Campaign → GrupoDistribucion → Anuncio). Mapea al Ad Set de
 * Meta u otra estructura equivalente. El adaptador hace la traducción.
 */
export interface GrupoDistribucion {
  readonly grupoId: string;
  readonly audiencia: PoliticaAudiencia;
  readonly placements: readonly string[];
  readonly schedule: { readonly inicio: string | null; readonly fin: string | null };
  readonly presupuesto: PoliticaPresupuesto;
  readonly objetivoOptimizacion: string;
  readonly restricciones: readonly string[];
}

export interface CampanaAdquisicion {
  readonly campanaId: string;
  readonly organizationId: string;
  readonly businessKey: string;
  readonly objetivo: ObjetivoComercial;
  readonly canal: CanalAdquisicion;
  readonly estado: EstadoCampana;
  readonly presupuesto: PoliticaPresupuesto;
  readonly gruposDistribucion: readonly GrupoDistribucion[];
  readonly creativeSet: readonly string[];
  readonly destino: string;
  readonly requisitosMedicion: readonly string[];
  readonly mandatoRef: string | null;
  /** Verdad estructural: ¿esta campaña creó objetos externos? En este bloque, SIEMPRE false. */
  readonly objetosExternosCreados: number;
}

export class TransicionCampanaInvalidaError extends Error {
  constructor(desde: EstadoCampana, hacia: EstadoCampana) {
    super(`Transición de campaña inválida: ${desde} → ${hacia}`);
    this.name = 'TransicionCampanaInvalidaError';
  }
}
