/**
 * apps/api · CAPA DE COMPOSICIÓN · SERVICIO del PLAN DE ACCIÓN (G1 · ASISTIDO DRY-RUN).
 *
 * Orquesta el recorrido COMPLETO en dry-run, SIN efecto externo:
 *   Lectura Director (evidencia real) + términos reales (M8)
 *     → PlanificadorDeCambios (Decision, puro)      → IntenciónDeCambio[]
 *     → evaluarGates                                → ResultadoGates
 *     → aprobación SIMULADA (ASISTIDO)              → registro
 *     → Executor DRY-RUN (simularEjecucion)         → SimulacionEjecucion
 *     → auditoría (stream `autonomia-ads:<org>`).
 *
 * Con la evidencia real actual ⇒ CERO propuestas (prevalece OBSERVAR). El recorrido se prueba E2E igualmente.
 * NADA se ejecuta: `AUTONOMOUS_REAL` está apagado y el Executor sólo simula.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { CAMPANIA_SMILEFLOW } from '../real-director/criterio-smileflow';
import { LecturaDirectorRealService } from '../real-director/lectura-director-real';
import { LIMITES_SMILEFLOW } from './limites-smileflow';
import { evaluarOportunidadesTacticas, planificarCambios, type IntencionDeCambio, type InsumosPlan } from './intencion';
import type { EvaluacionTermino } from './evaluacion-termino';
import { evaluarGates, type ContextoGates, type NivelAutonomia, type ResultadoGates } from './gates';
import { simularEjecucion, type SimulacionEjecucion } from './executor-dryrun';

export type PerfilUsuario = 'CONSERVADOR' | 'ASISTIDO' | 'AUTONOMO';
export const EVENTO_PLAN = 'plan-accion.dryrun';
export function planAccionStreamId(org: string): string {
  return `autonomia-ads:${org}`;
}

/** El interruptor maestro REAL (espejo de @soec/cia `AUTONOMOUS_REAL`). En G1 SIEMPRE false. */
const AUTONOMOUS_REAL_G1 = false as const;

function nivelDePerfil(perfil: PerfilUsuario): NivelAutonomia {
  if (perfil === 'CONSERVADOR') return 'RECOMENDAR';
  if (perfil === 'AUTONOMO') return 'EJECUTAR_AUTOMATICO';
  return 'EJECUTAR_CON_APROBACION'; // ASISTIDO
}

export interface AprobacionSimulada {
  readonly requerida: boolean;
  readonly simulada: boolean;
  readonly actor: string | null;
  readonly nota: string;
}

export interface PlanItem {
  readonly intencion: IntencionDeCambio;
  readonly gates: ResultadoGates;
  readonly aprobacion: AprobacionSimulada;
  readonly simulacion: SimulacionEjecucion;
}

export interface PlanAccionDryRun {
  readonly modo: 'DRY_RUN';
  readonly autonomousReal: false;
  readonly perfil: PerfilUsuario;
  readonly veredicto: string;
  readonly totalPropuestas: number;
  readonly resumenSimple: string;
  readonly items: readonly PlanItem[];
  /**
   * OPORTUNIDADES TÁCTICAS (informativas, NO ejecutables): búsquedas de bajo rendimiento (0 clics) que SOEC
   * NO propone excluir — sugiere revisar el mensaje. Distinto de una recomendación estratégica del Director.
   */
  readonly oportunidadesTacticas: readonly EvaluacionTermino[];
  readonly at: string;
}

const ATRIB: Attribution = {
  source: 'plan-accion-dryrun',
  purpose: 'plan de acción en dry-run (sin efecto externo)',
  assumptions: ['AUTONOMOUS_REAL apagado; Executor sólo simula; ninguna acción real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

export class PlanAccionDryRunService {
  private readonly observaciones: ObservacionService;
  private readonly lecturaSvc: LecturaDirectorRealService;

  constructor(private readonly store: EventStore) {
    this.observaciones = new ObservacionService(store, {} as never);
    this.lecturaSvc = new LecturaDirectorRealService(store);
  }

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('plan-accion'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `plan-accion-${org}` };
  }

  /** Términos de búsqueda REALES agregados por término (excluye diagnóstico). */
  private async leerTerminos(ctx: RequestContext): Promise<{ termino: string; impresiones: number; clics: number }[]> {
    const ids = await this.observaciones.listarIds(ctx);
    const map = new Map<string, { impresiones: number; clics: number }>();
    for (const id of ids) {
      const st = await this.observaciones.cargar(ctx, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      if (p.provider !== 'google-ads' || p.diagnostico || p.eventName !== 'ads_search_term') continue;
      const termino = p.utmContent;
      if (!termino) continue;
      const acc = map.get(termino) ?? { impresiones: 0, clics: 0 };
      if (d.metrica === 'search_term_impressions') acc.impresiones += d.valor ?? 0;
      else if (d.metrica === 'search_term_clicks') acc.clics += d.valor ?? 0;
      map.set(termino, acc);
    }
    return [...map.entries()].map(([termino, v]) => ({ termino, ...v }));
  }

  async generar(org: string, ahora: string, opts?: { perfil?: PerfilUsuario }): Promise<PlanAccionDryRun> {
    const ctx = this.ctx(org);
    const perfil = opts?.perfil ?? 'ASISTIDO';
    const lect = await this.lecturaSvc.leerUltima(org);
    const terminos = await this.leerTerminos(ctx);

    const insumos: InsumosPlan = {
      org,
      customerId: CAMPANIA_SMILEFLOW.campaignId,
      campaniaRef: CAMPANIA_SMILEFLOW.campaniaRef,
      evidenciaSuficiente: lect?.interpretacion.evidenciaSuficiente ?? false,
      clasificacionDesempeno: lect?.interpretacion.clasificacionDesempeno ?? 'sin_datos',
      roiClasificacion: lect?.interpretacion.roi.clasificacion ?? 'NO_EVALUABLE',
      decisionTipo: null,
      terminos,
      limites: LIMITES_SMILEFLOW,
    };

    const intenciones = planificarCambios(insumos);
    const oportunidadesTacticas = evaluarOportunidadesTacticas(insumos);
    const nivel = nivelDePerfil(perfil);
    const ctxGates: ContextoGates = {
      autonomousReal: AUTONOMOUS_REAL_G1, // false ⇒ dry-run
      killSwitchActivo: false,
      pausado: false,
      nivelAutonomia: nivel,
      autorizacionVigente: true, // en G1 se asume autorización de capacidad vigente (simulada)
      limiteDisponible: true,
      aprobacionHumana: true, // APROBACIÓN SIMULADA (no hay humano real en G1)
      cambiosHoy: 0,
      cooldownVigente: false,
      customerIdAutorizado: CAMPANIA_SMILEFLOW.campaignId,
    };

    const items: PlanItem[] = intenciones.map((intencion) => {
      const gates = evaluarGates(intencion, ctxGates, LIMITES_SMILEFLOW);
      const requerida = intencion.autorizacionRequerida === 'HUMANA_POR_CAMBIO';
      const aprobacion: AprobacionSimulada = {
        requerida,
        simulada: requerida,
        actor: requerida ? 'DRY-RUN (humano simulado)' : null,
        nota: requerida ? 'En producción, esto requiere que una persona apruebe cada cambio antes de ejecutar.' : 'Acción de bajo riesgo (en etapa futura podría no requerir aprobación por cambio).',
      };
      const simulacion = simularEjecucion(intencion, gates);
      return { intencion, gates, aprobacion, simulacion };
    });

    const resumenSimple = items.length > 0
      ? `SOEC preparó ${items.length} recomendación${items.length > 1 ? 'es' : ''} para tu revisión. Es una SIMULACIÓN: no se ejecutó nada y no se tocó tu campaña. Vos decidís si aprobar.`
      : oportunidadesTacticas.length > 0
        ? `Ningún cambio para aprobar. SOEC observa ${oportunidadesTacticas.length} búsqueda${oportunidadesTacticas.length > 1 ? 's' : ''} con impresiones pero 0 clics: NO propone excluirlas (bajo rendimiento no es lo mismo que irrelevancia) — sugiere revisar el anuncio/mensaje. La evidencia todavía no justifica excluir tráfico.`
        : 'Ahora mismo no hay nada que cambiar en tu campaña: la evidencia todavía es poca, así que SOEC solo observa. Cuando haya datos suficientes, aquí verás recomendaciones claras para aprobar o rechazar.';

    const plan: PlanAccionDryRun = {
      modo: 'DRY_RUN',
      autonomousReal: false,
      perfil,
      veredicto: lect?.veredicto ?? 'NO_EVALUABLE',
      totalPropuestas: items.length,
      resumenSimple,
      items,
      oportunidadesTacticas,
      at: ahora,
    };

    await this.persistir(ctx, plan);
    return plan;
  }

  private async persistir(ctx: RequestContext, plan: PlanAccionDryRun): Promise<void> {
    const streamId = planAccionStreamId(String(ctx.organizationId));
    const eventos = await this.store.readStream(ctx, streamId);
    try {
      await this.store.append(ctx, streamId, eventos.length, [{ type: EVENTO_PLAN, payload: plan, attribution: ATRIB, occurredAt: plan.at }]);
    } catch {
      // carrera ⇒ tolerada (last-wins)
    }
  }

  async leerUltimo(org: string): Promise<PlanAccionDryRun | null> {
    const ctx = this.ctx(org);
    const eventos = await this.store.readStream(ctx, planAccionStreamId(org));
    let ultimo: PlanAccionDryRun | null = null;
    for (const e of eventos) if (e.type === EVENTO_PLAN) ultimo = e.payload as PlanAccionDryRun;
    return ultimo;
  }
}
