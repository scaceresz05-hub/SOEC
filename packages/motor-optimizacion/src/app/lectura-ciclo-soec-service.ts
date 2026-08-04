/**
 * @soec/motor-optimizacion · aplicación · LECTURA GLOBAL DEL CICLO SOEC (`LecturaCicloSOEC`).
 *
 * Fachada de SOLO LECTURA, deep-frozen y multi-tenant, del ciclo funcional: ciclos, propuestas, decisiones,
 * derivaciones y vigencia. M9/consumidores leen; no reescriben la historia de SOEC.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import type { LecturaCicloSOEC, CicloM9, PropuestaM9, DecisionM9 } from '../contratos';
import { OptimizacionService } from './optimizacion-service';
import { PropuestaService } from './propuesta-service';
import { MemoriaDecisionesService } from './memoria-decisiones-service';

export function congelar<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) congelar(v); }
  return x;
}

const PROP_VIGENTE = new Set(['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'APLICADA_SIMULADA']);

export class LecturaCicloSoecService implements LecturaCicloSOEC {
  constructor(
    private readonly store: EventStore,
    private readonly optimizacion: OptimizacionService,
    private readonly propuestas: PropuestaService,
    private readonly memoria: MemoriaDecisionesService,
  ) { void this.store; }

  private cicloM9(id: string, st: Awaited<ReturnType<OptimizacionService['cargar']>>): CicloM9 {
    return { cicloId: id, estado: st.estado, objetivo: st.cuerpo.objetivo, segmento: st.cuerpo.segmento, propuestaId: st.cuerpo.propuestaId, oportunidades: st.cuerpo.oportunidades.length, alternativas: st.cuerpo.alternativas.length, evaluable: st.estado === 'EVALUABLE' || st.estado === 'PROPUESTAS_GENERADAS' || st.estado === 'PENDIENTE_APROBACION' || st.estado === 'APROBADO' || st.estado === 'APLICADO_SIMULADO' };
  }

  async listarCiclos(ctx: RequestContext): Promise<readonly CicloM9[]> {
    const out: CicloM9[] = [];
    for (const id of await this.optimizacion.listarIds(ctx)) { const st = await this.optimizacion.cargar(ctx, id); if (st.existe) out.push(this.cicloM9(id, st)); }
    return congelar(out);
  }

  async cargarCiclo(ctx: RequestContext, cicloId: string): Promise<CicloM9 | null> {
    const st = await this.optimizacion.cargar(ctx, cicloId);
    return st.existe ? congelar(this.cicloM9(cicloId, st)) : null;
  }

  private propM9(id: string, st: Awaited<ReturnType<PropuestaService['cargar']>>): PropuestaM9 {
    return { propuestaId: id, cicloId: st.cuerpo?.cicloId ?? '', estado: st.estado, aprobada: st.estado === 'APROBADA' || st.estado === 'APLICADA_SIMULADA', aplicada: st.estado === 'APLICADA_SIMULADA', vigente: PROP_VIGENTE.has(st.estado), derivaciones: st.derivaciones };
  }

  async listarPropuestas(ctx: RequestContext): Promise<readonly PropuestaM9[]> {
    const out: PropuestaM9[] = [];
    for (const id of await this.propuestas.listarIds(ctx)) { const st = await this.propuestas.cargar(ctx, id); if (st.existe) out.push(this.propM9(id, st)); }
    return congelar(out);
  }

  async cargarPropuesta(ctx: RequestContext, propuestaId: string): Promise<PropuestaM9 | null> {
    const st = await this.propuestas.cargar(ctx, propuestaId);
    return st.existe ? congelar(this.propM9(propuestaId, st)) : null;
  }

  async memoriaDecisiones(ctx: RequestContext): Promise<readonly DecisionM9[]> {
    const out: DecisionM9[] = (await this.memoria.listar(ctx)).map((m) => ({ propuestaId: m.propuestaId, cicloId: m.cicloId, decision: m.decision, actorHumano: m.actorHumano, aplicada: m.aplicada, derivaciones: m.derivaciones }));
    return congelar(out);
  }
}
