/**
 * Experiencia de marketing autónomo (F2-MKT-01). Siembra una estrategia SINTÉTICA
 * de PyME de servicios, genera el plan, y conduce el ciclo: próxima acción →
 * autorización (plano operacional) → ejecución SIMULADA → verificación →
 * replanificación. Contexto sintético server-side. Ningún efecto externo real.
 */
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import {
  ObjectiveService,
  PlanningService,
  type PlanState,
  IDS_DEMO,
  objetivoDemo,
  optsDemo,
  politicaDemo,
  siguienteActividad,
} from '@soec/marketing';

const ORG = 'pyme-mkt-demo';
const ATRIBUCION: Attribution = {
  source: 'experiencia-marketing',
  purpose: 'planificar y ejecutar marketing autorizado por política',
  assumptions: ['estrategia sintética; efectos simulados; ningún dato real'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};

export interface EstadoMarketing {
  existe: boolean;
  empresa: string;
  objetivo: {
    objetivoComercial: string;
    indicador: string;
    lineaBase: number;
    valorEsperado: number;
    horizonteDias: number;
  } | null;
  plan: {
    planVersion: number;
    estado: string;
    iniciativas: PlanState['iniciativas'];
    campanias: PlanState['campanias'];
    calendario: PlanState['calendario'];
    presupuesto: PlanState['presupuesto'];
    actividades: PlanState['actividades'][string][];
    historial: PlanState['historial'];
  } | null;
  siguiente: { id: string; canal: string; fechaProgramada: string } | null;
}

export class MarketingExperience {
  private readonly operational: OperationalService;
  private readonly policies: PolicyService;
  private readonly objetivos: ObjectiveService;
  private readonly planning: PlanningService;

  constructor(store: EventStore) {
    this.operational = new OperationalService(store, [new AdaptadorSimulado()]);
    this.policies = new PolicyService(store);
    this.objetivos = new ObjectiveService(store);
    this.planning = new PlanningService(store, this.operational);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return {
      organizationId,
      actor: ActorId('soec'),
      scope: { organizationId, permissions: ['events:append', 'events:read'] },
      correlationId: `exp-mkt-${ORG}`,
    };
  }
  private now(): string {
    return new Date().toISOString();
  }

  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_DEMO.plan);
    if (plan.existe) return;
    await this.objetivos.registrar(ctx, IDS_DEMO.objetivo, objetivoDemo, ATRIBUCION, this.now());
    const rp = await this.policies.registrarVersion(
      ctx,
      IDS_DEMO.politica,
      politicaDemo,
      ATRIBUCION,
      this.now(),
    );
    await this.policies.publicar(ctx, IDS_DEMO.politica, rp.version, ATRIBUCION, this.now());
    await this.planning.generarPlan(ctx, {
      planId: IDS_DEMO.plan,
      objetivoId: IDS_DEMO.objetivo,
      policyId: IDS_DEMO.politica,
      fechaInicio: this.now(),
      opts: optsDemo,
      attribution: ATRIBUCION,
      occurredAt: this.now(),
    });
  }

  async estado(): Promise<EstadoMarketing> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_DEMO.plan);
    const obj = await this.objetivos.cargar(ctx, IDS_DEMO.objetivo);
    const sig = siguienteActividad(plan);
    return {
      existe: plan.existe,
      empresa: obj.contenido?.empresa ?? 'Pyme de servicios (demo)',
      objetivo: obj.contenido
        ? {
            objetivoComercial: obj.contenido.objetivoComercial,
            indicador: obj.contenido.indicador,
            lineaBase: obj.contenido.lineaBase,
            valorEsperado: obj.contenido.valorEsperado,
            horizonteDias: obj.contenido.horizonteDias,
          }
        : null,
      plan: plan.existe
        ? {
            planVersion: plan.planVersion,
            estado: plan.estado,
            iniciativas: plan.iniciativas,
            campanias: plan.campanias,
            calendario: plan.calendario,
            presupuesto: plan.presupuesto,
            actividades: Object.values(plan.actividades).sort(
              (a, b) =>
                a.fechaProgramada.localeCompare(b.fechaProgramada) || a.id.localeCompare(b.id),
            ),
            historial: plan.historial,
          }
        : null,
      siguiente: sig
        ? { id: sig.id, canal: sig.canal, fechaProgramada: sig.fechaProgramada }
        : null,
    };
  }

  async ejecutarSiguiente(): Promise<{
    actividad: string;
    permitida: boolean;
    motivo: string | null;
    resultado: string;
  }> {
    const r = await this.planning.ejecutarSiguiente(
      this.ctx(),
      IDS_DEMO.plan,
      ATRIBUCION,
      this.now(),
    );
    return {
      actividad: r.actividad,
      permitida: r.permitida,
      motivo: r.motivo,
      resultado: r.resultado,
    };
  }

  async replanificar(motivo: string): Promise<{ planVersion: number }> {
    const r = await this.planning.replanificar(this.ctx(), {
      planId: IDS_DEMO.plan,
      motivo,
      evidencia: 'ajuste del ciclo operativo',
      attribution: ATRIBUCION,
      occurredAt: this.now(),
    });
    return { planVersion: r.planVersion };
  }

  async pausar(): Promise<void> {
    await this.planning.pausar(
      this.ctx(),
      IDS_DEMO.plan,
      'pausa del dueño',
      ATRIBUCION,
      this.now(),
    );
  }
  async reanudar(): Promise<void> {
    await this.planning.reanudar(this.ctx(), IDS_DEMO.plan, ATRIBUCION, this.now());
  }
}
