/**
 * @soec/motor-creativo · aplicación · GOBERNANZA CREATIVA (vigencia como gate transversal ÚNICO).
 *
 * `evaluarVigenciaCreativa` es la operación canónica que TODO camino de gobernanza (devolver estrategia
 * vigente, aprobar, crear/aprobar variante, calendarizar, listar piezas aprobadas para M7) debe invocar
 * antes de proceder. Deriva la vigencia contra M5 (autoridad única) y, si el artefacto quedó obsoleto,
 * MATERIALIZA ese estado en los agregados dependientes de forma idempotente — nunca coexiste una consulta
 * "obsoleto" con un agregado que siga apareciendo "vigente". El artefacto histórico se conserva.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import { EstrategiaCreativaArtefactoService } from '@soec/estrategia-creativa';
import { EVENTOS_PAQ, paqueteStreamId, reconstruirPaquete } from '@soec/contenido';
import { type DictamenVigencia, type RefConEstado, evaluarVigencia } from '../dominio/vigencia-creativa';
import type { RefVersionada } from '../dominio/vigencia';

export interface ObjetivoMaterializacion {
  readonly estrategiaCreativaId?: string;
  readonly paqueteId?: string;
}

export class GobernanzaCreativaService {
  private readonly artefacto: EstrategiaCreativaArtefactoService;
  constructor(
    private readonly store: EventStore,
    private readonly conocimiento: LecturaConocimiento,
  ) {
    this.artefacto = new EstrategiaCreativaArtefactoService(store);
  }

  /** Deriva la vigencia de un conjunto de referencias M5 (sin efectos). */
  async dictaminar(ctx: RequestContext, refsM5: readonly RefVersionada[]): Promise<DictamenVigencia> {
    const refs: RefConEstado[] = [];
    for (const r of refsM5) {
      const af = await this.conocimiento.cargar(ctx, r.afirmacionId);
      const estadoActual = af.existe ? (await this.conocimiento.evaluar(ctx, r.afirmacionId)).evaluacion.estado : null;
      refs.push({ afirmacionId: r.afirmacionId, versionEsperada: r.version, versionActual: af.existe ? af.version : null, estadoActual });
    }
    return evaluarVigencia(refs);
  }

  /**
   * Gate canónico: deriva la vigencia y, si NO es VIGENTE, materializa la obsolescencia en los agregados
   * indicados (idempotente). Devuelve el dictamen. Todos los gates de gobernanza pasan por aquí.
   */
  async evaluarVigenciaCreativa(
    ctx: RequestContext,
    refsM5: readonly RefVersionada[],
    materializar: ObjetivoMaterializacion,
    a: Attribution,
    o: string,
  ): Promise<DictamenVigencia> {
    const dictamen = await this.dictaminar(ctx, refsM5);
    if (dictamen.estado !== 'VIGENTE') {
      if (materializar.estrategiaCreativaId) {
        const art = await this.artefacto.cargar(ctx, materializar.estrategiaCreativaId);
        if (art.existe) await this.artefacto.marcarObsoleto(ctx, materializar.estrategiaCreativaId, dictamen.estado, a, o);
      }
      if (materializar.paqueteId) {
        await this.materializarPieza(ctx, materializar.paqueteId, dictamen.estado, dictamen.motivo, a, o);
      }
    }
    return dictamen;
  }

  /** Materializa (idempotente) la obsolescencia de la pieza (paquete) sin tocar su contenido/huella. */
  private async materializarPieza(ctx: RequestContext, paqueteId: string, vigencia: 'OBSOLETO' | 'REQUIERE_REVISION', motivo: string, a: Attribution, o: string): Promise<void> {
    const st = reconstruirPaquete(paqueteId, String(ctx.organizationId), await this.store.readStream(ctx, paqueteStreamId(paqueteId)));
    if (!st.existe || !st.pieza) return;
    if (st.pieza.vigencia === vigencia) return; // idempotente en contenido
    const input: EventInput = { type: EVENTOS_PAQ.obsoleta, payload: { vigencia, motivo }, attribution: a, occurredAt: o };
    await this.store.append(ctx, paqueteStreamId(paqueteId), st.version, [input]);
  }
}
