/**
 * @soec/motor-optimizacion · CONTRATOS (puertos).
 *
 * - `AplicadorCambios`: puerto de ESCRITURA CANÓNICA. M9 no escribe estados internos: delega la creación de
 *   NUEVAS versiones (M5/M6/M7) en los servicios canónicos de cada macrobloque. Devuelve la derivación.
 * - `LecturaCicloSOEC`: lectura GLOBAL, inmutable y multi-tenant del ciclo funcional de SOEC. No expone
 *   escritura. M9/consumidores leen; no reescriben la historia.
 */
import type { Attribution, RequestContext } from '@soec/contracts';
import type { Derivacion } from '../dominio/propuesta';
import type { VariableCambio } from '../dominio/optimizacion-tipos';
import type { VersionesBase, EstadoCiclo } from '../dominio/ciclo';
import type { EstadoPropuesta } from '../dominio/propuesta';

export interface CambioAAplicar {
  readonly variable: VariableCambio;
  readonly valorNuevo: string;
  readonly versionesBase: VersionesBase;
}

/** Aplica un cambio creando una NUEVA versión canónica (M5/M6/M7). Nunca sobrescribe. Todo SIMULADO. */
export interface AplicadorCambios {
  aplicar(ctx: RequestContext, cambio: CambioAAplicar, a: Attribution, o: string): Promise<Derivacion>;
}

export interface CicloM9 {
  readonly cicloId: string;
  readonly estado: EstadoCiclo;
  readonly objetivo: string;
  readonly segmento: string;
  readonly propuestaId: string | null;
  readonly oportunidades: number;
  readonly alternativas: number;
  readonly evaluable: boolean;
}

export interface PropuestaM9 {
  readonly propuestaId: string;
  readonly cicloId: string;
  readonly estado: EstadoPropuesta;
  readonly aprobada: boolean;
  readonly aplicada: boolean;
  readonly vigente: boolean;
  readonly derivaciones: readonly Derivacion[];
}

export interface DecisionM9 {
  readonly propuestaId: string;
  readonly cicloId: string;
  readonly decision: string;
  readonly actorHumano: string | null;
  readonly aplicada: boolean;
  readonly derivaciones: readonly Derivacion[];
}

/** PUERTO DE LECTURA GLOBAL para el ciclo funcional de SOEC. Solo lectura; snapshots inmutables. */
export interface LecturaCicloSOEC {
  listarCiclos(ctx: RequestContext): Promise<readonly CicloM9[]>;
  cargarCiclo(ctx: RequestContext, cicloId: string): Promise<CicloM9 | null>;
  listarPropuestas(ctx: RequestContext): Promise<readonly PropuestaM9[]>;
  cargarPropuesta(ctx: RequestContext, propuestaId: string): Promise<PropuestaM9 | null>;
  memoriaDecisiones(ctx: RequestContext): Promise<readonly DecisionM9[]>;
}
