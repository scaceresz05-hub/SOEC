/**
 * Experiencia de medición y optimización (F2-MET-01). Siembra el pipeline sintético,
 * publica (simulado), ingiere métricas de una fuente simulada (o emulada por HTTP),
 * evalúa la calidad de la evidencia, atribuye con cautela, detecta anomalías, evalúa el
 * objetivo y propone optimizaciones que —tras autorización— cambian el plan de forma
 * versionada. Contexto sintético server-side. Sin gasto ni datos reales.
 */
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import {
  ContentService,
  MarcaService,
  PromptService,
  ProveedorGenerativoDeterminista,
  CONT_GANCHOS,
  IDS_CONT,
  IDS_MKT_CONT,
  marcaDemo,
  objetivoContenidoDemo,
  optsContenidoDemo,
  politicaContenidoDemo,
  promptAdaptDemo,
  promptPiezaDemo,
} from '@soec/contenido';
import {
  AdaptadorCanalSimulado,
  FixtureCredentialProvider,
  PublicationService,
} from '@soec/canales';
import {
  MeasurementService,
  OptimizationService,
  CRITERIO_DEMO,
  GASTO_AUTORIZADO_DEMO,
  POLICY_OPT_DEMO,
  medStreamId,
  reconstruirMed,
  type MedState,
  type OptimizacionState,
} from '@soec/medicion';
import { FuenteMetricasSimulada, type FilaProveedor } from '@soec/medicion';

const ORG = 'pyme-met-demo';
const CUENTA = 'cuenta-demo';
const CRED = 'cred-demo';
const PUBLICABLES = ['blog', 'linkedin', 'correo'];
const ATRIBUCION: Attribution = {
  source: 'experiencia-medicion',
  purpose: 'medir y optimizar sobre datos sintéticos, dentro de políticas',
  assumptions: ['datos sintéticos; sin gasto real; el escalamiento requiere aprobación'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};

type Escenario = 'alto' | 'bajo' | 'insuficiente' | 'gasto_excedido';

function filas(externalRef: string, escenario: Escenario, seq = 1): FilaProveedor[] {
  const f = (
    metrica: string,
    valor: number,
    unidad = 'conteo',
    moneda: string | null = null,
  ): FilaProveedor => ({
    externalId: externalRef,
    metrica,
    valor,
    unidad,
    moneda,
    periodo: '2026-07-21',
    ocurridoEn: '2026-07-21T00:00:00.000Z',
    proveedorSeq: seq,
    acumulativa: true,
    estimada: false,
  });
  if (escenario === 'insuficiente')
    return [
      f('impresiones', 20),
      f('clics', 2),
      f('leads', 1),
      f('conversiones', 0),
      f('gasto', 5, 'monetario', 'CLP'),
    ];
  if (escenario === 'bajo')
    return [
      f('impresiones', 1000),
      f('clics', 100),
      f('leads', 10),
      f('conversiones', 0),
      f('gasto', 200, 'monetario', 'CLP'),
    ];
  if (escenario === 'gasto_excedido')
    return [
      f('impresiones', 1000),
      f('clics', 100),
      f('leads', 10),
      f('conversiones', 8),
      f('gasto', 9000, 'monetario', 'CLP'),
    ];
  return [
    f('impresiones', 1000),
    f('clics', 100),
    f('leads', 40),
    f('conversiones', 8),
    f('gasto', 200, 'monetario', 'CLP'),
  ];
}

export interface ActividadMedicion {
  id: string;
  canal: string;
  publicationId: string | null;
  externalRef: string | null;
  calidad: string | null;
  clasificacion: string | null;
  indicadores: { tipo: string; valor: number | null }[];
  atribucion: { modelo: string; clase: string; conversiones: number } | null;
  anomalias: { codigo: string; severidad: string }[];
  optimizacion: { tipo: string; estado: string; motivoDenegacion: string | null } | null;
}
export interface EstadoMedicion {
  existe: boolean;
  empresa: string;
  escenario: Escenario;
  actividades: ActividadMedicion[];
}

export class MeasurementExperience {
  private readonly policies: PolicyService;
  private readonly objetivos: ObjectiveService;
  private readonly planning: PlanningService;
  private readonly marcas: MarcaService;
  private readonly prompts: PromptService;
  private readonly content: ContentService;
  private readonly publicaciones: PublicationService;
  private readonly source: FuenteMetricasSimulada;
  private readonly medicionSvc: MeasurementService;
  private readonly optimizacionSvc: OptimizationService;
  private escenario: Escenario = 'bajo';

  constructor(private readonly store: EventStore) {
    const operational = new OperationalService(store, [new AdaptadorSimulado()]);
    this.policies = new PolicyService(store);
    this.objetivos = new ObjectiveService(store);
    this.planning = new PlanningService(store, operational);
    this.marcas = new MarcaService(store);
    this.prompts = new PromptService(store);
    this.content = new ContentService(store, new ProveedorGenerativoDeterminista(), this.planning);
    const creds = new FixtureCredentialProvider();
    creds.registrarTodosLosCanales(ORG, CUENTA, CRED, [
      'blog',
      'linkedin',
      'correo',
      'instagram',
      'meta_ads',
      'facebook',
    ]);
    const simulado = new AdaptadorCanalSimulado();
    this.publicaciones = new PublicationService(
      store,
      { simulado, sandbox: simulado },
      creds,
      this.content,
    );
    this.source = new FuenteMetricasSimulada();
    this.medicionSvc = new MeasurementService(store, this.source);
    this.optimizacionSvc = new OptimizationService(store, this.planning);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return {
      organizationId,
      actor: ActorId('soec'),
      scope: { organizationId, permissions: ['events:append', 'events:read'] },
      correlationId: `exp-met-${ORG}`,
    };
  }
  private now(): string {
    return new Date().toISOString();
  }
  private paqueteId(actividadId: string): string {
    return `${IDS_MKT_CONT.plan}--${actividadId}`;
  }
  private pubId(actividadId: string, canal: string): string {
    return `${this.paqueteId(actividadId)}__${canal}`;
  }

  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    if (!plan.existe) {
      const rm = await this.marcas.registrarVersion(
        ctx,
        IDS_CONT.marca,
        marcaDemo,
        ATRIBUCION,
        this.now(),
      );
      await this.marcas.publicar(ctx, IDS_CONT.marca, rm.version, ATRIBUCION, this.now());
      const rp1 = await this.prompts.registrarVersion(
        ctx,
        IDS_CONT.promptPieza,
        promptPiezaDemo,
        ATRIBUCION,
        this.now(),
      );
      await this.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, ATRIBUCION, this.now());
      const rp2 = await this.prompts.registrarVersion(
        ctx,
        IDS_CONT.promptAdapt,
        promptAdaptDemo,
        ATRIBUCION,
        this.now(),
      );
      await this.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, ATRIBUCION, this.now());
      await this.objetivos.registrar(
        ctx,
        IDS_MKT_CONT.objetivo,
        objetivoContenidoDemo,
        ATRIBUCION,
        this.now(),
      );
      const rpol = await this.policies.registrarVersion(
        ctx,
        IDS_MKT_CONT.politica,
        politicaContenidoDemo,
        ATRIBUCION,
        this.now(),
      );
      await this.policies.publicar(
        ctx,
        IDS_MKT_CONT.politica,
        rpol.version,
        ATRIBUCION,
        this.now(),
      );
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
    // Producir contenido y publicar (simulado) los canales de texto publicables.
    for (const canal of PUBLICABLES) {
      const actividadId = `act-${canal}-0`;
      await this.content.prepararContenidoParaActividad(ctx, {
        planId: IDS_MKT_CONT.plan,
        actividadId,
        marcaId: IDS_CONT.marca,
        promptPiezaId: IDS_CONT.promptPieza,
        promptAdaptId: IDS_CONT.promptAdapt,
        ganchosPromocionales: CONT_GANCHOS,
        attribution: ATRIBUCION,
        occurredAt: this.now(),
      });
      const pub = await this.publicaciones.cargar(ctx, this.pubId(actividadId, canal));
      if (!pub.existe) {
        await this.publicaciones.publicarCiclo(ctx, {
          paqueteId: this.paqueteId(actividadId),
          canal,
          policyId: IDS_MKT_CONT.politica,
          modo: 'simulado',
          cuentaLogica: CUENTA,
          credencialId: CRED,
          attribution: ATRIBUCION,
          occurredAt: this.now(),
        });
      }
    }
  }

  private med(ctx: RequestContext, publicationId: string): Promise<MedState> {
    return this.store
      .readStream(ctx, medStreamId(publicationId))
      .then((e) => reconstruirMed(publicationId, ctx.organizationId, e));
  }

  async sincronizarTodo(escenario: Escenario): Promise<{ medidas: number }> {
    const ctx = this.ctx();
    this.escenario = escenario;
    let medidas = 0;
    for (const canal of PUBLICABLES) {
      const actividadId = `act-${canal}-0`;
      const pub = await this.publicaciones.cargar(ctx, this.pubId(actividadId, canal));
      if (!pub.existe || !pub.externalRef) continue;
      this.source.cargar(
        pub.externalRef,
        filas(
          pub.externalRef,
          escenario,
          1 + (await this.med(ctx, pub.publicationId)).sincronizaciones,
        ),
      );
      await this.medicionSvc.sincronizar(ctx, {
        publicationId: pub.publicationId,
        externalRef: pub.externalRef,
        canal,
        cuenta: CUENTA,
        token: 't',
        campaniaRef: `cmp-${canal}`,
        objetivoRef: IDS_MKT_CONT.objetivo,
        criterio: CRITERIO_DEMO,
        gastoAutorizado: GASTO_AUTORIZADO_DEMO,
        muestraMinima: 500,
        attribution: ATRIBUCION,
        occurredAt: this.now(),
      });
      medidas += 1;
    }
    return { medidas };
  }

  async optimizarTodo(): Promise<{ propuestas: number; aplicadas: number; denegadas: number }> {
    const ctx = this.ctx();
    let propuestas = 0;
    let aplicadas = 0;
    let denegadas = 0;
    for (const canal of PUBLICABLES) {
      const actividadId = `act-${canal}-0`;
      const pub = await this.publicaciones.cargar(ctx, this.pubId(actividadId, canal));
      if (!pub.existe) continue;
      const med = await this.med(ctx, pub.publicationId);
      if (!med.evaluacion) continue;
      const opt = await this.optimizacionSvc.optimizar(ctx, {
        publicationId: pub.publicationId,
        planId: IDS_MKT_CONT.plan,
        campaniaId: `cmp-${canal}`,
        actividadId,
        canal,
        objetivoId: IDS_MKT_CONT.objetivo,
        policyIdOperacional: IDS_MKT_CONT.politica,
        policyOpt: POLICY_OPT_DEMO,
        attribution: ATRIBUCION,
        occurredAt: this.now(),
      });
      propuestas += 1;
      if (opt.estado === 'aplicada') aplicadas += 1;
      if (opt.estado === 'denegada') denegadas += 1;
    }
    return { propuestas, aplicadas, denegadas };
  }

  private resumenOpt(o: OptimizacionState): {
    tipo: string;
    estado: string;
    motivoDenegacion: string | null;
  } {
    return {
      tipo: o.decision?.tipo ?? '—',
      estado: o.estado,
      motivoDenegacion: o.motivoDenegacion,
    };
  }

  async estado(): Promise<EstadoMedicion> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const actividades: ActividadMedicion[] = [];
    for (const canal of PUBLICABLES) {
      const actividadId = `act-${canal}-0`;
      if (!plan.actividades[actividadId]) continue;
      const pub = await this.publicaciones.cargar(ctx, this.pubId(actividadId, canal));
      const med = pub.existe ? await this.med(ctx, pub.publicationId) : null;
      const opt = pub.existe
        ? await this.optimizacionSvc.cargar(
            ctx,
            `${pub.publicationId}__opt${med?.sincronizaciones ?? 1}`,
          )
        : null;
      actividades.push({
        id: actividadId,
        canal,
        publicationId: pub.existe ? pub.publicationId : null,
        externalRef: pub.externalRef,
        calidad: med?.calidad ?? null,
        clasificacion: med?.evaluacion?.clasificacion ?? null,
        indicadores: (med?.indicadores ?? []).map((i) => ({ tipo: i.tipo, valor: i.valor })),
        atribucion: med?.atribucion
          ? {
              modelo: med.atribucion.modelo,
              clase: med.atribucion.clase,
              conversiones: med.atribucion.conversiones,
            }
          : null,
        anomalias: (med?.anomalias ?? []).map((a) => ({
          codigo: a.codigo,
          severidad: a.severidad,
        })),
        optimizacion: opt && opt.existe ? this.resumenOpt(opt) : null,
      });
    }
    return {
      existe: plan.existe,
      empresa: objetivoContenidoDemo.empresa,
      escenario: this.escenario,
      actividades,
    };
  }
}
