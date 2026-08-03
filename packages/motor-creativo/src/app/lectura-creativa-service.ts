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
  AprobacionService,
  type ArtefactoCreativoState,
  type ExperimentoABState,
  type CalendarioState,
} from '@soec/estrategia-creativa';
import { BriefService, type BriefState, type PaqueteState, paqueteStreamId, reconstruirPaquete } from '@soec/contenido';
import { MotorCreativoService } from './motor-creativo-service';
import { GobernanzaCreativaService } from './gobernanza-creativa-service';
import { SolicitudAprobacionService } from './solicitud-aprobacion-service';
import { congelarProfundo } from '../dominio/congelar';
import type { EstadoSolicitud } from '../dominio/solicitud-aprobacion';
import type { ContextoCreativoState } from '../dominio/contexto-creativo';
import type { TerritorioState } from '../dominio/territorio';
import type { ResultadoCreativo } from '../dominio/abstencion';
import { type Vigencia, estadoVigencia } from '../dominio/vigencia';
import { indicePiezasStreamId, reconstruirIndicePiezas } from '../dominio/indice-piezas';
import type { EntradaTerritorio, EvaluacionTerritorio, LecturaCreativa, PiezaAprobada } from '../contratos';

export class LecturaCreativaService implements LecturaCreativa {
  private readonly motor: MotorCreativoService;
  private readonly brief: BriefService;
  private readonly artefacto: EstrategiaCreativaArtefactoService;
  private readonly variantes: VariantesABService;
  private readonly calendario: CalendarioEditorialService;
  private readonly aprobacion: AprobacionService;
  private readonly gobernanza: GobernanzaCreativaService;

  constructor(
    private readonly store: EventStore,
    private readonly conocimiento: LecturaConocimiento,
  ) {
    this.motor = new MotorCreativoService(store, conocimiento);
    this.brief = new BriefService(store);
    this.artefacto = new EstrategiaCreativaArtefactoService(store);
    this.variantes = new VariantesABService(store);
    this.calendario = new CalendarioEditorialService(store);
    this.aprobacion = new AprobacionService(store);
    this.gobernanza = new GobernanzaCreativaService(store, conocimiento);
    this.solicitud = new SolicitudAprobacionService(store, this.aprobacion);
  }
  private readonly solicitud: SolicitudAprobacionService;

  /** Estado de la solicitud de aprobación de una VERSIÓN de pieza, relativo a la versión vigente actual. */
  async estadoSolicitudPieza(ctx: RequestContext, paqueteId: string, versionSolicitada: number): Promise<EstadoSolicitud> {
    const paq = await this.cargarPieza(ctx, paqueteId);
    return this.solicitud.estado(ctx, 'PIEZA', paqueteId, versionSolicitada, paq.version);
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

  async listarPiezasAprobadas(ctx: RequestContext): Promise<readonly PiezaAprobada[]> {
    const org = String(ctx.organizationId);
    const idx = reconstruirIndicePiezas(org, await this.store.readStream(ctx, indicePiezasStreamId(org)));
    const out: PiezaAprobada[] = [];
    for (const paqueteId of idx.paquetes) {
      const paq = reconstruirPaquete(paqueteId, org, await this.store.readStream(ctx, paqueteStreamId(paqueteId)));
      if (!paq.existe || !paq.pieza) continue;
      if (paq.estado === 'retirado') continue; // pieza retirada nunca se lista
      const refsM5 = (paq.pieza.referenciasM5 ?? []).map((r) => ({ afirmacionId: r.afirmacionId, version: r.version }));
      // Autoridad ÚNICA: se DERIVA la vigencia contra M5 (no se confía en la caché materializada).
      const dictamen = await this.gobernanza.dictaminar(ctx, refsM5);
      if (dictamen.estado !== 'VIGENTE') continue;
      if (!(await this.aprobacion.estaAprobada(ctx, 'PIEZA', paqueteId, paq.version))) continue;
      // Consistencia pieza–variante: toda variante del experimento de la pieza debe estar aprobada
      // vigente. Una variante no aprobada / rechazada / retirada excluye la pieza (no es ejecutable).
      const exp = await this.variantes.cargar(ctx, paqueteId);
      if (exp.existe) {
        let variantesOk = true;
        for (const v of exp.variantes) {
          if (!(await this.aprobacion.aprobadaVigente(ctx, 'VARIANTE', v.varianteId))) { variantesOk = false; break; }
        }
        if (!variantesOk) continue;
      }
      out.push({
        paqueteId,
        version: paq.version,
        referenciasM5: refsM5,
        trazabilidad: (paq.pieza.trazabilidad ?? []).map((t) => ({ afirmacionId: t.afirmacionId, version: t.version, estado: t.estado, mensajeId: t.mensajeId })),
      });
    }
    // Inmutabilidad en RUNTIME: los snapshots para M7 se congelan en profundidad (readonly no basta).
    return congelarProfundo(out);
  }
}
