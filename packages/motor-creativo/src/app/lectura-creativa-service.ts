/**
 * @soec/motor-creativo · aplicación · FACHADA de lectura para M7 (`LecturaCreativa`).
 *
 * Compone, en un único puerto de SOLO LECTURA, las proyecciones que M7 necesita: contexto/territorio del
 * motor creativo (M6) + brief/pieza (@soec/contenido) + estrategia/variantes/calendario
 * (@soec/estrategia-creativa). No expone escritura ni estado mutable: devuelve estados reconstruidos.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import {
  EstrategiaCreativaArtefactoService,
  VariantesABService,
  CalendarioEditorialService,
  type ArtefactoCreativoState,
  type ExperimentoABState,
  type CalendarioState,
} from '@soec/estrategia-creativa';
import { BriefService, type BriefState, type PaqueteState, paqueteStreamId, reconstruirPaquete } from '@soec/contenido';
import { MotorCreativoService } from './motor-creativo-service';
import type { ContextoCreativoState } from '../dominio/contexto-creativo';
import type { TerritorioState } from '../dominio/territorio';
import type { ResultadoCreativo } from '../dominio/abstencion';
import { type Vigencia, estadoVigencia } from '../dominio/vigencia';
import type { EntradaTerritorio, EvaluacionTerritorio, LecturaCreativa } from '../contratos';

export class LecturaCreativaService implements LecturaCreativa {
  private readonly motor: MotorCreativoService;
  private readonly brief: BriefService;
  private readonly artefacto: EstrategiaCreativaArtefactoService;
  private readonly variantes: VariantesABService;
  private readonly calendario: CalendarioEditorialService;

  constructor(
    private readonly store: EventStore,
    private readonly conocimiento: LecturaConocimiento,
  ) {
    this.motor = new MotorCreativoService(store, conocimiento);
    this.brief = new BriefService(store);
    this.artefacto = new EstrategiaCreativaArtefactoService(store);
    this.variantes = new VariantesABService(store);
    this.calendario = new CalendarioEditorialService(store);
  }

  cargarContexto(ctx: RequestContext, contextoId: string): Promise<ContextoCreativoState> {
    return this.motor.cargarContexto(ctx, contextoId);
  }

  async vigenciaContexto(ctx: RequestContext, contextoId: string): Promise<Vigencia> {
    const st = await this.motor.cargarContexto(ctx, contextoId);
    if (!st.existe) return 'OBSOLETO';
    const versionesActuales: Record<string, number> = {};
    for (const r of st.referencias) {
      const af = await this.conocimiento.cargar(ctx, r.afirmacionId);
      if (af.existe) versionesActuales[r.afirmacionId] = af.version;
    }
    return st.obsoleto ? 'OBSOLETO' : estadoVigencia(st.referencias.map((r) => ({ afirmacionId: r.afirmacionId, version: r.version })), versionesActuales);
  }

  cargarBrief(ctx: RequestContext, briefId: string): Promise<BriefState> {
    return this.brief.cargar(ctx, briefId);
  }

  cargarTerritorio(ctx: RequestContext, territorioId: string): Promise<TerritorioState> {
    return this.motor.cargarTerritorio(ctx, territorioId);
  }

  listarTerritorios(ctx: RequestContext): Promise<readonly EntradaTerritorio[]> {
    return this.motor.listarTerritorios(ctx);
  }

  evaluarTerritorio(ctx: RequestContext, territorioId: string): Promise<ResultadoCreativo<EvaluacionTerritorio>> {
    return this.motor.evaluarTerritorio(ctx, territorioId);
  }

  cargarEstrategia(ctx: RequestContext, estrategiaCreativaId: string): Promise<ArtefactoCreativoState> {
    return this.artefacto.cargar(ctx, estrategiaCreativaId);
  }

  async cargarPieza(ctx: RequestContext, paqueteId: string): Promise<PaqueteState> {
    return reconstruirPaquete(paqueteId, String(ctx.organizationId), await this.store.readStream(ctx, paqueteStreamId(paqueteId)));
  }

  cargarExperimento(ctx: RequestContext, piezaBaseId: string): Promise<ExperimentoABState> {
    return this.variantes.cargar(ctx, piezaBaseId);
  }

  cargarCalendario(ctx: RequestContext, programaId: string): Promise<CalendarioState> {
    return this.calendario.cargar(ctx, programaId);
  }
}
