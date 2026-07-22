/**
 * Experiencia de la Fábrica Autónoma de Contenido (F2-CONT-01). Siembra la
 * estrategia SINTÉTICA (marca + prompts versionados + plan de marketing con
 * campañas sin contenido) y conduce el ciclo: actividad bloqueada por
 * contenido_faltante → brief → pieza → adaptaciones → validación → revisión →
 * paquete → entrega (actividad autorizable) → ejecución SIMULADA → verificación.
 * Contexto sintético server-side. Ningún efecto externo real.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService, type PlanState } from '@soec/marketing';
import {
  ContentService,
  MarcaService,
  PromptService,
  ProveedorGenerativoDeterminista,
  type PaqueteState,
  IDS_CONT,
  IDS_MKT_CONT,
  CONT_GANCHOS,
  marcaDemo,
  promptPiezaDemo,
  promptAdaptDemo,
  objetivoContenidoDemo,
  politicaContenidoDemo,
  optsContenidoDemo,
} from '@soec/contenido';

const ORG = 'pyme-cont-demo';
const ATRIBUCION: Attribution = {
  source: 'experiencia-contenido',
  purpose: 'producir contenido de marketing autorizado por política',
  assumptions: ['estrategia sintética; efectos simulados; proveedor generativo determinista (no IA real)'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};

export interface PaqueteResumen {
  paqueteId: string;
  actividadId: string;
  canal: string;
  estado: string;
  resultado: string | null;
  adaptaciones: { canal: string; formato: string; estado: string; titulo: string; cuerpo: string; hashtags: readonly string[]; llamadaAccion: string }[];
  activos: { tipo: string; descripcion: string }[];
  hallazgos: { codigo: string; severidad: string; descripcion: string; bloqueante: boolean }[];
  revisiones: { ronda: number; motivo: string; accion: string }[];
  afirmaciones: { texto: string; tipo: string; fuente: string }[];
  ejecucion: string | null;
}

export interface EstadoContenido {
  existe: boolean;
  empresa: string;
  marca: string;
  plan: { planVersion: number; estado: string } | null;
  actividades: {
    id: string;
    canal: string;
    estado: string;
    motivoBloqueo: string | null;
    paquete: PaqueteResumen | null;
  }[];
}

export class ContentExperience {
  private readonly policies: PolicyService;
  private readonly objetivos: ObjectiveService;
  private readonly planning: PlanningService;
  private readonly marcas: MarcaService;
  private readonly prompts: PromptService;
  private readonly content: ContentService;

  constructor(private readonly store: EventStore) {
    const operational = new OperationalService(store, [new AdaptadorSimulado()]);
    this.policies = new PolicyService(store);
    this.objetivos = new ObjectiveService(store);
    this.planning = new PlanningService(store, operational);
    this.marcas = new MarcaService(store);
    this.prompts = new PromptService(store);
    this.content = new ContentService(store, new ProveedorGenerativoDeterminista(), this.planning);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions: ['events:append', 'events:read'] }, correlationId: `exp-cont-${ORG}` };
  }
  private now(): string {
    return new Date().toISOString();
  }

  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    if (plan.existe) return;
    // Marca y prompts versionados.
    const rm = await this.marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, ATRIBUCION, this.now());
    await this.marcas.publicar(ctx, IDS_CONT.marca, rm.version, ATRIBUCION, this.now());
    const rp1 = await this.prompts.registrarVersion(ctx, IDS_CONT.promptPieza, promptPiezaDemo, ATRIBUCION, this.now());
    await this.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, ATRIBUCION, this.now());
    const rp2 = await this.prompts.registrarVersion(ctx, IDS_CONT.promptAdapt, promptAdaptDemo, ATRIBUCION, this.now());
    await this.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, ATRIBUCION, this.now());
    // Estrategia de marketing con campañas sin contenido (todas bloqueadas por contenido_faltante).
    await this.objetivos.registrar(ctx, IDS_MKT_CONT.objetivo, objetivoContenidoDemo, ATRIBUCION, this.now());
    const rpol = await this.policies.registrarVersion(ctx, IDS_MKT_CONT.politica, politicaContenidoDemo, ATRIBUCION, this.now());
    await this.policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, ATRIBUCION, this.now());
    await this.planning.generarPlan(ctx, {
      planId: IDS_MKT_CONT.plan,
      objetivoId: IDS_MKT_CONT.objetivo,
      policyId: IDS_MKT_CONT.politica,
      fechaInicio: this.now(),
      opts: optsContenidoDemo,
      attribution: ATRIBUCION,
      occurredAt: this.now(),
    });
  }

  private resumen(p: PaqueteState): PaqueteResumen {
    return {
      paqueteId: p.paqueteId,
      actividadId: p.actividadRef,
      canal: p.canal,
      estado: p.estado,
      resultado: p.resultadoProduccion,
      adaptaciones: p.adaptaciones.map((a) => ({ canal: a.canal, formato: a.formato, estado: a.estado, titulo: a.titulo, cuerpo: a.cuerpo, hashtags: a.hashtags, llamadaAccion: a.llamadaAccion })),
      activos: p.activos.map((a) => ({ tipo: a.tipo, descripcion: a.descripcion })),
      hallazgos: p.hallazgos.map((h) => ({ codigo: h.codigo, severidad: h.severidad, descripcion: h.descripcion, bloqueante: h.bloqueante })),
      revisiones: p.revisiones.map((r) => ({ ronda: r.ronda, motivo: r.motivo, accion: r.accion })),
      afirmaciones: (p.pieza?.afirmaciones ?? []).map((af) => ({ texto: af.texto, tipo: af.tipo, fuente: af.fuente })),
      ejecucion: p.resultadoEjecucion,
    };
  }

  async estado(): Promise<EstadoContenido> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const actividades = Object.values(plan.actividades).sort((a, b) => a.canal.localeCompare(b.canal));
    const salida: EstadoContenido['actividades'] = [];
    for (const a of actividades) {
      const paquete = await this.content.cargarPaquete(ctx, `${IDS_MKT_CONT.plan}--${a.id}`);
      salida.push({ id: a.id, canal: a.canal, estado: a.estado, motivoBloqueo: a.motivoBloqueo, paquete: paquete.existe ? this.resumen(paquete) : null });
    }
    return {
      existe: plan.existe,
      empresa: objetivoContenidoDemo.empresa,
      marca: marcaDemo.nombre,
      plan: plan.existe ? { planVersion: plan.planVersion, estado: plan.estado } : null,
      actividades: salida,
    };
  }

  async prepararActividad(actividadId: string): Promise<{ actividadDesbloqueada: boolean; motivo: string; paquete: PaqueteResumen }> {
    const r = await this.content.prepararContenidoParaActividad(this.ctx(), {
      planId: IDS_MKT_CONT.plan,
      actividadId,
      marcaId: IDS_CONT.marca,
      promptPiezaId: IDS_CONT.promptPieza,
      promptAdaptId: IDS_CONT.promptAdapt,
      ganchosPromocionales: CONT_GANCHOS,
      attribution: ATRIBUCION,
      occurredAt: this.now(),
    });
    return { actividadDesbloqueada: r.actividadDesbloqueada, motivo: r.motivo, paquete: this.resumen(r.paquete) };
  }

  /** Prepara todas las actividades bloqueadas por contenido_faltante (Caso A/B/E). */
  async prepararTodo(): Promise<{ preparadas: number; desbloqueadas: number }> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    let preparadas = 0;
    let desbloqueadas = 0;
    for (const a of Object.values(plan.actividades)) {
      if (a.estado === 'bloqueada' && a.motivoBloqueo === 'contenido_faltante') {
        const r = await this.prepararActividad(a.id);
        preparadas += 1;
        if (r.actividadDesbloqueada) desbloqueadas += 1;
      }
    }
    return { preparadas, desbloqueadas };
  }

  async ejecutarSiguiente(): Promise<{ actividad: string | null; permitida: boolean; resultado: string }> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    if (!hayAutorizable(plan)) return { actividad: null, permitida: false, resultado: 'no hay acciones autorizables' };
    const r = await this.planning.ejecutarSiguiente(ctx, IDS_MKT_CONT.plan, ATRIBUCION, this.now());
    const paqueteId = `${IDS_MKT_CONT.plan}--${r.actividad}`;
    const existe = await this.content.cargarPaquete(ctx, paqueteId);
    if (existe.existe) {
      await this.content.registrarEjecucion(ctx, paqueteId, { permitida: r.permitida, resultado: r.resultado, executionRef: `${IDS_MKT_CONT.plan}:${r.actividad}`, attribution: ATRIBUCION, occurredAt: this.now() });
    }
    return { actividad: r.actividad, permitida: r.permitida, resultado: r.resultado };
  }
}

function hayAutorizable(plan: PlanState): boolean {
  return Object.values(plan.actividades).some((a) => a.estado === 'autorizable');
}
