/**
 * Centro de Control del Departamento Autónomo (F2-CTRL-01). Compone —por contratos
 * públicos y proyecciones— todo el ciclo operacional (objetivos → plan → contenido →
 * publicaciones → métricas → evaluación → optimización → políticas/presupuesto/riesgos)
 * en un resumen dirigible. Gobierna con PAUSA real (integrada con la ejecución: cuando
 * hay pausa no se producen nuevos efectos, pero las lecturas continúan), una bandeja de
 * DECISIONES y ALERTAS. No modifica agregados de otros módulos ni salta la autorización.
 * Modo simulado; ningún efecto/gasto público real.
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
  FuenteMetricasSimulada,
  medStreamId,
  reconstruirMed,
  type FilaProveedor,
  type MedState,
} from '@soec/medicion';
import {
  PausaService,
  DecisionService,
  InboxService,
  calcularSalud,
  type Alcance,
  type ContenidoDecision,
  type EstadoSalud,
  type Rol,
  type SenalesSalud,
} from '@soec/control';

const ORG = 'pyme-ctrl-demo';
const CANALES = ['blog', 'linkedin', 'correo'];
const A: Attribution = {
  source: 'centro-de-control',
  purpose: 'gobernar el departamento autónomo',
  assumptions: ['datos sintéticos; sin gasto real; modo real desactivado'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};
type Escenario = 'bajo' | 'alto' | 'insuficiente' | 'gasto_excedido';

function filas(ref: string, esc: Escenario, seq = 1): FilaProveedor[] {
  const f = (m: string, v: number, u = 'conteo', mo: string | null = null): FilaProveedor => ({
    externalId: ref,
    metrica: m,
    valor: v,
    unidad: u,
    moneda: mo,
    periodo: '2026-07-21',
    ocurridoEn: '2026-07-21T00:00:00.000Z',
    proveedorSeq: seq,
    acumulativa: true,
    estimada: false,
  });
  if (esc === 'insuficiente')
    return [
      f('impresiones', 20),
      f('clics', 2),
      f('leads', 1),
      f('conversiones', 0),
      f('gasto', 5, 'monetario', 'CLP'),
    ];
  if (esc === 'alto')
    return [
      f('impresiones', 1000),
      f('clics', 100),
      f('leads', 40),
      f('conversiones', 8),
      f('gasto', 200, 'monetario', 'CLP'),
    ];
  if (esc === 'gasto_excedido')
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
    f('leads', 10),
    f('conversiones', 0),
    f('gasto', 200, 'monetario', 'CLP'),
  ];
}

export class ControlExperience {
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
  private readonly pausa: PausaService;
  private readonly decisiones: DecisionService;
  private readonly inbox: InboxService;
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
    creds.registrarTodosLosCanales(ORG, 'cuenta-demo', 'cred-demo', [
      'blog',
      'linkedin',
      'correo',
      'instagram',
      'meta_ads',
      'facebook',
    ]);
    const sim = new AdaptadorCanalSimulado();
    this.publicaciones = new PublicationService(
      store,
      { simulado: sim, sandbox: sim },
      creds,
      this.content,
    );
    this.source = new FuenteMetricasSimulada();
    this.medicionSvc = new MeasurementService(store, this.source);
    this.optimizacionSvc = new OptimizationService(store, this.planning);
    this.pausa = new PausaService(store);
    this.decisiones = new DecisionService(store);
    this.inbox = new InboxService(store);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return {
      organizationId,
      actor: ActorId('soec'),
      scope: { organizationId, permissions: ['events:append', 'events:read'] },
      correlationId: `exp-ctrl-${ORG}`,
    };
  }
  private now(): string {
    return new Date().toISOString();
  }
  private paqueteId(a: string): string {
    return `${IDS_MKT_CONT.plan}--${a}`;
  }
  private pubId(a: string, canal: string): string {
    return `${this.paqueteId(a)}__${canal}`;
  }
  private med(ctx: RequestContext, publicationId: string): Promise<MedState> {
    return this.store
      .readStream(ctx, medStreamId(publicationId))
      .then((e) => reconstruirMed(publicationId, ctx.organizationId, e));
  }

  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    if (!plan.existe) {
      const rm = await this.marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, A, this.now());
      await this.marcas.publicar(ctx, IDS_CONT.marca, rm.version, A, this.now());
      const rp1 = await this.prompts.registrarVersion(
        ctx,
        IDS_CONT.promptPieza,
        promptPiezaDemo,
        A,
        this.now(),
      );
      await this.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, A, this.now());
      const rp2 = await this.prompts.registrarVersion(
        ctx,
        IDS_CONT.promptAdapt,
        promptAdaptDemo,
        A,
        this.now(),
      );
      await this.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, A, this.now());
      await this.objetivos.registrar(
        ctx,
        IDS_MKT_CONT.objetivo,
        objetivoContenidoDemo,
        A,
        this.now(),
      );
      const rpol = await this.policies.registrarVersion(
        ctx,
        IDS_MKT_CONT.politica,
        politicaContenidoDemo,
        A,
        this.now(),
      );
      await this.policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, A, this.now());
      await this.planning.generarPlan(ctx, {
        planId: IDS_MKT_CONT.plan,
        objetivoId: IDS_MKT_CONT.objetivo,
        policyId: IDS_MKT_CONT.politica,
        fechaInicio: this.now(),
        opts: optsContenidoDemo,
        attribution: A,
        occurredAt: this.now(),
      });
    }
    for (const canal of CANALES) {
      const a = `act-${canal}-0`;
      await this.content.prepararContenidoParaActividad(ctx, {
        planId: IDS_MKT_CONT.plan,
        actividadId: a,
        marcaId: IDS_CONT.marca,
        promptPiezaId: IDS_CONT.promptPieza,
        promptAdaptId: IDS_CONT.promptAdapt,
        ganchosPromocionales: CONT_GANCHOS,
        attribution: A,
        occurredAt: this.now(),
      });
      if (!(await this.publicaciones.cargar(ctx, this.pubId(a, canal))).existe) {
        await this.publicaciones.publicarCiclo(ctx, {
          paqueteId: this.paqueteId(a),
          canal,
          policyId: IDS_MKT_CONT.politica,
          modo: 'simulado',
          cuentaLogica: 'cuenta-demo',
          credencialId: 'cred-demo',
          attribution: A,
          occurredAt: this.now(),
        });
      }
    }
  }

  /** Ciclo sintético: mide y optimiza, RESPETANDO la pausa; registra decisiones y alertas. */
  async simular(
    escenario: Escenario,
  ): Promise<{
    medidas: number;
    aplicadas: number;
    decisiones: number;
    alertas: number;
    pausado: boolean;
  }> {
    const ctx = this.ctx();
    this.escenario = escenario;
    if (await this.pausa.estaPausado(ctx))
      return { medidas: 0, aplicadas: 0, decisiones: 0, alertas: 0, pausado: true };
    let medidas = 0;
    let aplicadas = 0;
    let decisiones = 0;
    let alertas = 0;
    for (const canal of CANALES) {
      const a = `act-${canal}-0`;
      const pub = await this.publicaciones.cargar(ctx, this.pubId(a, canal));
      if (!pub.existe || !pub.externalRef) continue;
      // Cadena de ancestros del alcance (departamento global → canal → campaña).
      if (
        await this.pausa.estaPausado(ctx, [
          { tipo: 'canal', valor: canal },
          { tipo: 'campania', valor: `cmp-${canal}` },
        ])
      )
        continue;
      this.source.cargar(
        pub.externalRef,
        filas(
          pub.externalRef,
          escenario,
          1 + (await this.med(ctx, pub.publicationId)).sincronizaciones,
        ),
      );
      const med = await this.medicionSvc.sincronizar(ctx, {
        publicationId: pub.publicationId,
        externalRef: pub.externalRef,
        canal,
        cuenta: 'cuenta-demo',
        token: 't',
        campaniaRef: `cmp-${canal}`,
        objetivoRef: IDS_MKT_CONT.objetivo,
        criterio: CRITERIO_DEMO,
        gastoAutorizado: GASTO_AUTORIZADO_DEMO,
        muestraMinima: 500,
        attribution: A,
        occurredAt: this.now(),
      });
      medidas += 1;
      // Alerta por anomalía de gasto.
      const anom = med.anomalias.find((x) => x.codigo === 'gasto_superior_autorizado');
      if (anom) {
        await this.inbox.registrarAlerta(
          ctx,
          {
            clave: `gasto:${pub.publicationId}`,
            tipo: 'gasto_anomalo',
            severidad: 'critico',
            origen: 'medicion',
            entidad: pub.publicationId,
            evidencia: anom.evidencia,
            impacto: anom.impacto,
            accionAutomatica: 'escalamiento bloqueado',
            accionHumana: 'reconciliar el gasto',
          },
          A,
          this.now(),
        );
        alertas += 1;
      }
      const opt = await this.optimizacionSvc.optimizar(ctx, {
        publicationId: pub.publicationId,
        planId: IDS_MKT_CONT.plan,
        campaniaId: `cmp-${canal}`,
        actividadId: a,
        canal,
        objetivoId: IDS_MKT_CONT.objetivo,
        policyIdOperacional: IDS_MKT_CONT.politica,
        policyOpt: POLICY_OPT_DEMO,
        attribution: A,
        occurredAt: this.now(),
      });
      if (opt.estado === 'aplicada') aplicadas += 1;
      // Escalamiento denegado por política → decisión pendiente para el propietario.
      if (opt.estado === 'denegada' && opt.decision?.tipo === 'aumentar_frecuencia') {
        const dec: ContenidoDecision = {
          tipo: 'escalamiento_frecuencia',
          razon: opt.decision.motivo,
          alcance: `${canal}/${a}`,
          efectoEsperado: 'aumentar la frecuencia de la actividad',
          riesgo: 'medio',
          presupuestoImplicado: 0,
          evidencia: opt.decision.evidencia,
          alternativas: ['mantener', 'esperar más datos'],
          recomendacionSistema: 'aprobar si el objetivo estratégico prioriza volumen',
          politica: IDS_MKT_CONT.politica,
          refPlan: IDS_MKT_CONT.plan,
        };
        await this.decisiones.registrar(ctx, `dec-${pub.publicationId}`, dec, A, this.now());
        decisiones += 1;
      }
    }
    return { medidas, aplicadas, decisiones, alertas, pausado: false };
  }

  async pausar(
    tipo: Alcance['tipo'],
    valor: string,
    motivo: string,
    actor: string,
  ): Promise<{ pausaTotal: boolean }> {
    const s = await this.pausa.pausar(this.ctx(), { tipo, valor }, motivo, actor, A, this.now());
    return { pausaTotal: !!s.activas['departamento:*'] };
  }
  async reanudar(
    tipo: Alcance['tipo'],
    valor: string,
    actor: string,
  ): Promise<{ pausaTotal: boolean }> {
    const s = await this.pausa.reanudar(this.ctx(), { tipo, valor }, actor, A, this.now());
    return { pausaTotal: !!s.activas['departamento:*'] };
  }

  async decisionesPendientes() {
    const ctx = this.ctx();
    const out: {
      decId: string;
      tipo: string;
      riesgo: string;
      razon: string;
      estado: string;
      recomendacion: string;
    }[] = [];
    for (const canal of CANALES) {
      const d = await this.decisiones.cargar(ctx, `dec-${this.pubId(`act-${canal}-0`, canal)}`);
      if (d.existe && d.contenido)
        out.push({
          decId: d.decId,
          tipo: d.contenido.tipo,
          riesgo: d.contenido.riesgo,
          razon: d.contenido.razon,
          estado: d.estado,
          recomendacion: d.contenido.recomendacionSistema,
        });
    }
    return out;
  }

  async resolverDecision(
    decId: string,
    estado: 'aprobada' | 'denegada' | 'pospuesta',
    rol: Rol,
    actor: string,
    comentario: string,
  ): Promise<{ estado: string; efectoAplicado: boolean }> {
    const ctx = this.ctx();
    const d = await this.decisiones.resolver(
      ctx,
      decId,
      { estado, actor, rol, comentario },
      A,
      this.now(),
    );
    let efectoAplicado = false;
    // Si se APRUEBA un escalamiento, se aplica el efecto por el contrato público (versionado).
    if (estado === 'aprobada' && d.contenido?.tipo === 'escalamiento_frecuencia') {
      const [canal] = d.contenido.alcance.split('/');
      const a = d.contenido.alcance.split('/')[1] ?? `act-${canal}-0`;
      await this.planning.aplicarOptimizacion(
        ctx,
        IDS_MKT_CONT.plan,
        {
          tipo: 'aumentar_frecuencia',
          actividadId: a,
          valorAnterior: 'actual',
          valorNuevo: '+1/periodo',
          motivo: `aprobado por ${actor}`,
          optRef: decId,
          nuevoEstadoActividad: null,
        },
        A,
        this.now(),
      );
      efectoAplicado = true;
    }
    return { estado: d.estado, efectoAplicado };
  }

  private async senales(
    ctx: RequestContext,
  ): Promise<{ senales: SenalesSalud; meds: Record<string, MedState>; bloqueos: number }> {
    const pausa = await this.pausa.cargar(ctx);
    const inbox = await this.inbox.cargar(ctx);
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const meds: Record<string, MedState> = {};
    let riesgoCritico = 0;
    let advertencias = 0;
    let conDatos = false;
    for (const canal of CANALES) {
      const pub = await this.publicaciones.cargar(ctx, this.pubId(`act-${canal}-0`, canal));
      if (!pub.existe) continue;
      const med = await this.med(ctx, pub.publicationId);
      meds[canal] = med;
      if (med.evaluacion) conDatos = true;
      riesgoCritico += med.anomalias.filter((x) => x.severidad === 'critico').length;
      advertencias += med.anomalias.filter((x) => x.severidad !== 'critico').length;
    }
    const pendientes = (await this.decisionesPendientes()).filter(
      (d) => d.estado === 'pendiente',
    ).length;
    const bloqueos = Object.values(plan.actividades).filter(
      (a) => a.estado === 'bloqueada' || a.estado === 'omitida',
    ).length;
    const alertasCriticas = Object.values(inbox.alertas).filter(
      (al) => al.severidad === 'critico' && al.estado !== 'resuelta',
    ).length;
    const senales: SenalesSalud = {
      pausaTotal: !!pausa.activas['departamento:*'],
      riesgoCritico: riesgoCritico + alertasCriticas,
      intervencionRequerida: pendientes,
      bloqueos,
      advertencias,
      conDatos,
    };
    return { senales, meds, bloqueos };
  }

  async resumen() {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const { senales, meds } = await this.senales(ctx);
    const salud: EstadoSalud = calcularSalud(senales);
    const inbox = await this.inbox.cargar(ctx);

    let verificadas = 0;
    let optAplicadas = 0;
    const objetivos = [];
    for (const canal of CANALES) {
      const pub = await this.publicaciones.cargar(ctx, this.pubId(`act-${canal}-0`, canal));
      if (pub.existe && pub.estado === 'verificada') verificadas += 1;
      const med = meds[canal];
      if (med?.evaluacion) {
        objetivos.push({
          objetivoId: `${IDS_MKT_CONT.objetivo}:${canal}`,
          indicador: med.evaluacion.indicador,
          lineaBase: med.evaluacion.lineaBase,
          meta: med.evaluacion.meta,
          resultado: med.evaluacion.resultado,
          calidad: med.calidad,
          clasificacion: med.evaluacion.clasificacion,
        });
      }
    }
    optAplicadas = plan.optimizaciones.length;
    const excepciones = [];
    for (const al of Object.values(inbox.alertas).filter((x) => x.estado !== 'resuelta')) {
      excepciones.push({
        tipo: al.tipo,
        severidad: al.severidad,
        modulo: al.origen,
        entidad: al.entidad,
        descripcion: al.evidencia,
        accionAutomatica: al.accionAutomatica,
        accionHumana: al.accionHumana,
        estado: al.estado,
      });
    }
    const gastoTotal = Object.values(meds).reduce((s, m) => s + (m.metricas.gasto?.valor ?? 0), 0);
    return {
      organizationId: ORG,
      empresa: objetivoContenidoDemo.empresa,
      periodo: '2026-07',
      modo: 'simulado' as const,
      nivelAutonomia: politicaContenidoDemo.nivelAutonomia,
      salud,
      pausaTotal: senales.pausaTotal,
      escenario: this.escenario,
      objetivos,
      trabajo: {
        piezasCreadas: CANALES.length,
        publicacionesPreparadas: CANALES.length,
        publicacionesVerificadas: verificadas,
        campaniasActivas: plan.campanias.length,
        optimizacionesAplicadas: optAplicadas,
        retiros: 0,
        bloqueos: Object.values(plan.actividades).filter((x) => x.estado === 'bloqueada').length,
      },
      proximos: Object.values(plan.actividades)
        .filter((x) => x.estado === 'autorizable')
        .slice(0, 5)
        .map((x) => ({
          actividadId: x.id,
          canal: x.canal,
          fecha: x.fechaProgramada,
          estadoContenido: x.paqueteContenidoRef ? 'listo' : 'pendiente',
          estado: x.estado,
        })),
      excepciones,
      presupuesto: {
        moneda: 'CLP',
        produccion: CANALES.length * 3,
        distribucion: 0,
        publicidad: gastoTotal,
        planificado: politicaContenidoDemo.presupuestoTotal,
        comprometido: gastoTotal,
        ejecutado: gastoTotal,
        disponible: Math.max(0, politicaContenidoDemo.presupuestoTotal - gastoTotal),
        discrepancia:
          gastoTotal > politicaContenidoDemo.presupuestoTotal
            ? gastoTotal - politicaContenidoDemo.presupuestoTotal
            : 0,
      },
      decisionesPendientes: (await this.decisionesPendientes()).filter(
        (d) => d.estado === 'pendiente',
      ).length,
      alertasAbiertas: Object.values(inbox.alertas).filter((x) => x.estado === 'abierta').length,
      ultimaActualizacion: this.now(),
    };
  }

  async actividad() {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const out: { texto: string; automatico: boolean; simulado: boolean }[] = [];
    for (const o of plan.optimizaciones)
      out.push({
        texto: `SOEC ${o.tipo === 'pausar_actividad' ? 'pausó' : 'ajustó'} la actividad ${o.actividadId}: ${o.motivo}. El plan quedó versionado.`,
        automatico: true,
        simulado: true,
      });
    for (const canal of CANALES) {
      const pub = await this.publicaciones.cargar(ctx, this.pubId(`act-${canal}-0`, canal));
      if (pub.existe && pub.estado === 'verificada')
        out.push({
          texto: `SOEC publicó y verificó la pieza de ${canal} (efecto simulado).`,
          automatico: true,
          simulado: true,
        });
    }
    return out.reverse();
  }

  async alertas() {
    const inbox = await this.inbox.cargar(this.ctx());
    return Object.values(inbox.alertas).map((a) => ({
      tipo: a.tipo,
      severidad: a.severidad,
      estado: a.estado,
      evidencia: a.evidencia,
      accionAutomatica: a.accionAutomatica,
    }));
  }

  /** Auditoría: cadena objetivo → plan → publicación → medición → optimización de un canal. */
  async auditoria(canal: string) {
    const ctx = this.ctx();
    const a = `act-${canal}-0`;
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const pub = await this.publicaciones.cargar(ctx, this.pubId(a, canal));
    const med = pub.existe ? await this.med(ctx, pub.publicationId) : null;
    return {
      objetivo: IDS_MKT_CONT.objetivo,
      plan: {
        id: IDS_MKT_CONT.plan,
        version: plan.planVersion,
        optimizaciones: plan.optimizaciones.length,
      },
      actividad: {
        id: a,
        estado: plan.actividades[a]?.estado ?? null,
        paquete: plan.actividades[a]?.paqueteContenidoRef ?? null,
      },
      publicacion: pub.existe
        ? {
            estado: pub.estado,
            externalRef: pub.externalRef,
            modo: pub.modo,
            policyVersion: pub.policyVersion,
          }
        : null,
      medicion: med?.evaluacion
        ? {
            clasificacion: med.evaluacion.clasificacion,
            calidad: med.calidad,
            atribucion: med.atribucion?.clase,
          }
        : null,
    };
  }
}
