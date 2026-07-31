/**
 * @soec/estrategia-creativa · aplicación · Deriva la estrategia creativa desde el cerebro comercial y
 * la persiste (event-sourced, multi-tenant). Es la CONEXIÓN: consume `@soec/crm-comercial` (SSOT de
 * conocimiento comercial) y produce el insumo creativo que el pipeline existente sabe usar. No produce
 * efectos externos (sin publicación, sin gasto); una ABSTENCIÓN nunca se persiste como si fuera un plan.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { ProgramaService, type Programa } from '@soec/programas';
import {
  type DerivacionCreativa,
  EVENTOS_ESTCREATIVA,
  type EstrategiaCreativaState,
  derivarCreativa,
  estrategiaCreativaStreamId,
  reconstruirEstrategiaCreativa,
} from '../domain/estrategia-creativa';
import { type ParametrosCampania, type ResultadoConexion, derivarConexion } from '../domain/conexion';

export class EstrategiaCreativaService {
  private readonly conocimiento: ConocimientoComercialService;
  private readonly hipotesis: HipotesisComercialService;
  private readonly programas: ProgramaService;
  constructor(private readonly store: EventStore, conocimiento?: ConocimientoComercialService, hipotesis?: HipotesisComercialService, programas?: ProgramaService) {
    this.conocimiento = conocimiento ?? new ConocimientoComercialService(store);
    this.hipotesis = hipotesis ?? new HipotesisComercialService(store);
    this.programas = programas ?? new ProgramaService(store);
  }

  /**
   * Compone el PAQUETE DE CONEXIÓN completo (brief, estrategia, segmentos, hipótesis de programa,
   * objetivo) desde el conocimiento comercial + hipótesis comerciales + los parámetros de dirección.
   * Es la entrada real (no fixtures) para poblar `@soec/programas` y el pipeline. ABSTIENE si falta info.
   */
  async derivarConexion(ctx: RequestContext, params: ParametrosCampania): Promise<ResultadoConexion> {
    const state = await this.conocimiento.cargar(ctx);
    const idx = await this.hipotesis.listar(ctx);
    const hips = await Promise.all(idx.hipotesis.map((h) => this.hipotesis.cargar(ctx, h.hipotesisId)));
    return derivarConexion(state, hips, params);
  }

  /**
   * Puebla un `Programa` real de `@soec/programas` desde el paquete de conexión (segmentos + hipótesis
   * + objetivo derivados del cerebro comercial), listo para el ciclo existente (`CicloProgramaService`)
   * — en vez de fixtures. Idempotente (crear no re-crea). ABSTIENE (sin crear nada) si falta conocimiento.
   */
  async poblarPrograma(
    ctx: RequestContext,
    programaId: string,
    params: ParametrosCampania,
    a: Attribution,
    occurredAt: string,
  ): Promise<{ tipo: 'PROPUESTA'; programa: Programa } | { tipo: 'ABSTENCION'; faltantes: readonly string[] }> {
    const res = await this.derivarConexion(ctx, params);
    if (res.tipo === 'ABSTENCION') return res;
    const { paquete } = res;
    const programa = await this.programas.crear(
      ctx,
      programaId,
      {
        nombre: `Programa de ${paquete.objetivo.empresa}`,
        objetivoPrincipal: paquete.objetivo.objetivoMarketing,
        objetivosSecundarios: [paquete.objetivo.objetivoComercial],
        presupuestoTotalSimulado: paquete.objetivo.presupuestoTotal,
        moneda: paquete.objetivo.moneda,
      },
      a,
      occurredAt,
    );
    // Idempotente: sólo se agregan segmentos/hipótesis aún no presentes (crear devuelve el existente).
    const segPresentes = new Set(programa.segmentos.map((s) => s.id));
    for (const seg of paquete.segmentos) if (!segPresentes.has(seg.id)) await this.programas.agregarSegmento(ctx, programaId, seg, a, occurredAt);
    const hipPresentes = new Set(programa.hipotesis.map((h) => h.id));
    for (const hip of paquete.hipotesis) if (!hipPresentes.has(hip.id)) await this.programas.agregarHipotesis(ctx, programaId, hip, a, occurredAt);
    return { tipo: 'PROPUESTA', programa: await this.programas.cargar(ctx, programaId) };
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext): Promise<EstrategiaCreativaState> {
    const org = this.org(ctx);
    return reconstruirEstrategiaCreativa(org, await this.store.readStream(ctx, estrategiaCreativaStreamId(org)));
  }

  /** Deriva (sin persistir) la estrategia creativa desde el conocimiento comercial actual. */
  async derivar(ctx: RequestContext): Promise<DerivacionCreativa> {
    return derivarCreativa(await this.conocimiento.cargar(ctx));
  }

  /**
   * Deriva y, si es evaluable (PROPUESTA), la registra como estrategia creativa vigente. Si ABSTIENE,
   * devuelve la abstención con sus faltantes SIN persistir nada.
   */
  async derivarYRegistrar(ctx: RequestContext, a: Attribution, occurredAt: string): Promise<DerivacionCreativa> {
    const res = await this.derivar(ctx);
    if (res.tipo === 'ABSTENCION') return res;
    const st = await this.cargar(ctx);
    const input: EventInput = { type: EVENTOS_ESTCREATIVA.derivada, payload: { brief: res.brief, estrategia: res.estrategia }, attribution: a, occurredAt };
    await this.store.append(ctx, estrategiaCreativaStreamId(this.org(ctx)), st.version, [input]);
    return res;
  }
}
