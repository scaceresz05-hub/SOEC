/**
 * @soec/motor-creativo · CONTRATOS (puertos) para M7.
 *
 * M6 produce dirección creativa; M7 la EJECUTARÁ. M7 consume por `LecturaCreativa` (solo lectura) y no
 * puede modificar la dirección creativa de M6 ni el conocimiento de M5 (para eso hay servicios de
 * escritura propios que dejan eventos). Espeja el patrón de `LecturaConocimiento` de M5.
 */
import type { RequestContext } from '@soec/contracts';
import type { ContextoCreativoState } from '../dominio/contexto-creativo';
import type { TerritorioState } from '../dominio/territorio';
import type { ResultadoCreativo } from '../dominio/abstencion';

/** Evaluación agregada de un territorio (derivada de M5, nunca almacenada). */
export interface EvaluacionTerritorio {
  readonly territorioId: string;
  readonly sostenidas: number;
  readonly totalEvidencias: number;
  readonly audienciaSostenida: boolean;
}

export interface EntradaTerritorio {
  readonly territorioId: string;
  readonly tesis: string;
}

/** PUERTO DE LECTURA — lo que M7 (ejecución) necesita del motor creativo. Solo lectura. */
export interface LecturaCreativa {
  cargarContexto(ctx: RequestContext, contextoId: string): Promise<ContextoCreativoState>;
  cargarTerritorio(ctx: RequestContext, territorioId: string): Promise<TerritorioState>;
  listarTerritorios(ctx: RequestContext): Promise<readonly EntradaTerritorio[]>;
  /** Evaluabilidad del territorio derivada de M5 (PROPUESTA evaluable o ABSTENCIÓN explicada). */
  evaluarTerritorio(ctx: RequestContext, territorioId: string): Promise<ResultadoCreativo<EvaluacionTerritorio>>;
}
