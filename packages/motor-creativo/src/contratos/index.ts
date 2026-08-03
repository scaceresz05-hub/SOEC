/**
 * @soec/motor-creativo · CONTRATOS (puertos) para M7.
 *
 * M6 produce dirección creativa; M7 la EJECUTARÁ. M7 consume por `LecturaCreativa` (solo lectura) y no
 * puede modificar la dirección creativa de M6 ni el conocimiento de M5 (para eso hay servicios de
 * escritura propios que dejan eventos). Espeja el patrón de `LecturaConocimiento` de M5. Ningún método de
 * este puerto expone escritura ni estado interno mutable: devuelve proyecciones (estados reconstruidos).
 */
import type { RequestContext } from '@soec/contracts';
import type { ArtefactoCreativoState, ExperimentoABState, CalendarioState } from '@soec/estrategia-creativa';
import type { BriefState, PaqueteState } from '@soec/contenido';
import type { ContextoCreativoState } from '../dominio/contexto-creativo';
import type { TerritorioState } from '../dominio/territorio';
import type { ResultadoCreativo } from '../dominio/abstencion';
import type { Vigencia } from '../dominio/vigencia';

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

/**
 * PUERTO DE LECTURA — todo lo que M7 (ejecución) necesita del motor creativo, solo lectura: contexto,
 * brief, territorio, estrategia, pieza, variante/experimento, calendario y la vigencia/obsolescencia.
 */
export interface LecturaCreativa {
  cargarContexto(ctx: RequestContext, contextoId: string): Promise<ContextoCreativoState>;
  /** Vigencia del contexto contra M5 (VIGENTE/OBSOLETO), sin efectos. */
  vigenciaContexto(ctx: RequestContext, contextoId: string): Promise<Vigencia>;
  cargarBrief(ctx: RequestContext, briefId: string): Promise<BriefState>;
  cargarTerritorio(ctx: RequestContext, territorioId: string): Promise<TerritorioState>;
  listarTerritorios(ctx: RequestContext): Promise<readonly EntradaTerritorio[]>;
  evaluarTerritorio(ctx: RequestContext, territorioId: string): Promise<ResultadoCreativo<EvaluacionTerritorio>>;
  cargarEstrategia(ctx: RequestContext, estrategiaCreativaId: string): Promise<ArtefactoCreativoState>;
  /** Pieza (paquete de @soec/contenido) con su gobernanza M6 adjunta. */
  cargarPieza(ctx: RequestContext, paqueteId: string): Promise<PaqueteState>;
  cargarExperimento(ctx: RequestContext, piezaBaseId: string): Promise<ExperimentoABState>;
  cargarCalendario(ctx: RequestContext, programaId: string): Promise<CalendarioState>;
}
