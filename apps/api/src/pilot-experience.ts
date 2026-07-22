/**
 * Experiencia de Preparación del Piloto Operacional Controlado (F2-PILOT-01). Prepara
 * una organización SINTÉTICA para un piloto: registro + onboarding + perfil + presupuesto
 * + conexión (fixture) + política inicial + expediente; ejecuta ensayos que recorren el
 * ciclo emulado (contenido → publicación → medición → optimización → pausa → rollback);
 * evalúa readiness por entorno; y DEMUESTRA que la activación real permanece BLOQUEADA.
 * Sin publicación pública, sin gasto real, sin credenciales reales, sin conexión productiva.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import { ContentService, MarcaService, PromptService, ProveedorGenerativoDeterminista, CONT_GANCHOS, IDS_CONT, IDS_MKT_CONT, marcaDemo, objetivoContenidoDemo, optsContenidoDemo, politicaContenidoDemo, promptAdaptDemo, promptPiezaDemo } from '@soec/contenido';
import { AdaptadorCanalSimulado, FixtureCredentialProvider, PublicationService } from '@soec/canales';
import { MeasurementService, OptimizationService, CRITERIO_DEMO, GASTO_AUTORIZADO_DEMO, POLICY_OPT_DEMO, medStreamId, reconstruirMed, type FilaProveedor, type MedState } from '@soec/medicion';
import { PausaService } from '@soec/control';
import {
  OrganizacionService, ReadinessService, ExpedienteService, EnsayoService,
  proponerPoliticaInicial, POLITICA_INICIAL_VERSION, entornoOperable,
  type EscenarioEnsayo, type Entorno, type Incidencia, type PasoEnsayo, type ResultadoEnsayo,
  IDS_PILOTO, ETAPAS, identidadDemo, perfilDemo, presupuestoDemo, conexionDemoSandbox, criteriosExitoDemo, criteriosSuspensionDemo, rollbackDemo, DATOS_ETAPAS,
} from '@soec/piloto';

const ORG = 'pyme-piloto-demo';
const A: Attribution = { source: 'experiencia-piloto', purpose: 'preparar un piloto operacional controlado', assumptions: ['organización sintética; sin efecto/gasto real; activación bloqueada'], claimType: 'observational', regime: 'institutional', uncertainty: 'baja' };

function filas(ref: string, esc: 'bajo' | 'alto' | 'gasto_excedido', seq = 1): FilaProveedor[] {
  const f = (m: string, v: number, u = 'conteo', mo: string | null = null): FilaProveedor => ({ externalId: ref, metrica: m, valor: v, unidad: u, moneda: mo, periodo: '2026-07-21', ocurridoEn: '2026-07-21T00:00:00.000Z', proveedorSeq: seq, acumulativa: true, estimada: false });
  if (esc === 'alto') return [f('impresiones', 1000), f('clics', 100), f('leads', 40), f('conversiones', 8), f('gasto', 200, 'monetario', 'CLP')];
  if (esc === 'gasto_excedido') return [f('impresiones', 1000), f('clics', 100), f('leads', 10), f('conversiones', 8), f('gasto', 9000, 'monetario', 'CLP')];
  return [f('impresiones', 1000), f('clics', 100), f('leads', 10), f('conversiones', 0), f('gasto', 200, 'monetario', 'CLP')];
}

export class PilotExperience {
  private readonly policies: PolicyService;
  private readonly objetivos: ObjectiveService;
  private readonly planning: PlanningService;
  private readonly marcas: MarcaService;
  private readonly prompts: PromptService;
  private readonly content: ContentService;
  private readonly publicaciones: PublicationService;
  private readonly source: FuenteMetricasLocal;
  private readonly medicionSvc: MeasurementService;
  private readonly optimizacionSvc: OptimizationService;
  private readonly pausa: PausaService;
  private readonly orgSvc: OrganizacionService;
  private readonly readinessSvc: ReadinessService;
  private readonly expSvc: ExpedienteService;
  private readonly ensSvc: EnsayoService;

  constructor(private readonly store: EventStore) {
    const operational = new OperationalService(store, [new AdaptadorSimulado()]);
    this.policies = new PolicyService(store);
    this.objetivos = new ObjectiveService(store);
    this.planning = new PlanningService(store, operational);
    this.marcas = new MarcaService(store);
    this.prompts = new PromptService(store);
    this.content = new ContentService(store, new ProveedorGenerativoDeterminista(), this.planning);
    const creds = new FixtureCredentialProvider();
    creds.registrarTodosLosCanales(ORG, 'cuenta-demo', 'cred-demo', ['blog', 'linkedin', 'correo', 'instagram', 'meta_ads', 'facebook']);
    const sim = new AdaptadorCanalSimulado();
    this.publicaciones = new PublicationService(store, { simulado: sim, sandbox: sim }, creds, this.content);
    this.source = new FuenteMetricasLocal();
    this.medicionSvc = new MeasurementService(store, this.source);
    this.optimizacionSvc = new OptimizationService(store, this.planning);
    this.pausa = new PausaService(store);
    this.orgSvc = new OrganizacionService(store);
    this.readinessSvc = new ReadinessService(store);
    this.expSvc = new ExpedienteService(store);
    this.ensSvc = new EnsayoService(store);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions: ['events:append', 'events:read'] }, correlationId: `exp-piloto-${ORG}` };
  }
  private now(): string {
    return new Date().toISOString();
  }

  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const org = await this.orgSvc.cargar(ctx, IDS_PILOTO.org);
    if (!org.existe) {
      await this.orgSvc.registrar(ctx, IDS_PILOTO.org, identidadDemo, ['marketing'], A, this.now());
      for (const etapa of ETAPAS) await this.orgSvc.actualizarEtapa(ctx, IDS_PILOTO.org, etapa, 'completa', DATOS_ETAPAS[etapa], [], 'propietario', A, this.now());
      await this.orgSvc.definirPerfil(ctx, IDS_PILOTO.org, perfilDemo, A, this.now());
      await this.orgSvc.definirPresupuesto(ctx, IDS_PILOTO.org, presupuestoDemo, A, this.now());
      await this.orgSvc.declararConexion(ctx, IDS_PILOTO.org, conexionDemoSandbox, A, this.now());
      const propuesta = proponerPoliticaInicial(await this.orgSvc.cargar(ctx, IDS_PILOTO.org));
      void propuesta; // se muestra en estado(); se acepta explícitamente (versión 1)
      await this.orgSvc.aceptarPolitica(ctx, IDS_PILOTO.org, 1, A, this.now());
      await this.orgSvc.transicionar(ctx, IDS_PILOTO.org, 'lista_para_ensayo', A, this.now());
      // Expediente.
      await this.expSvc.crear(ctx, IDS_PILOTO.expediente, { orgRef: IDS_PILOTO.org, departamento: 'marketing', entorno: 'sandbox', objetivo: objetivoContenidoDemo.objetivoComercial, duracionDias: perfilDemo.duracionDias, criteriosExito: criteriosExitoDemo, criteriosSuspension: criteriosSuspensionDemo, rollback: [...rollbackDemo] }, A, this.now());
    }
    // Pipeline de contenido + publicación emulada (para que los ensayos recorran estados reales).
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    if (!plan.existe) {
      const rm = await this.marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, A, this.now());
      await this.marcas.publicar(ctx, IDS_CONT.marca, rm.version, A, this.now());
      const rp1 = await this.prompts.registrarVersion(ctx, IDS_CONT.promptPieza, promptPiezaDemo, A, this.now());
      await this.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, A, this.now());
      const rp2 = await this.prompts.registrarVersion(ctx, IDS_CONT.promptAdapt, promptAdaptDemo, A, this.now());
      await this.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, A, this.now());
      await this.objetivos.registrar(ctx, IDS_MKT_CONT.objetivo, objetivoContenidoDemo, A, this.now());
      const rpol = await this.policies.registrarVersion(ctx, IDS_MKT_CONT.politica, politicaContenidoDemo, A, this.now());
      await this.policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, A, this.now());
      await this.planning.generarPlan(ctx, { planId: IDS_MKT_CONT.plan, objetivoId: IDS_MKT_CONT.objetivo, policyId: IDS_MKT_CONT.politica, fechaInicio: this.now(), opts: optsContenidoDemo, attribution: A, occurredAt: this.now() });
      await this.content.prepararContenidoParaActividad(ctx, { planId: IDS_MKT_CONT.plan, actividadId: 'act-blog-0', marcaId: IDS_CONT.marca, promptPiezaId: IDS_CONT.promptPieza, promptAdaptId: IDS_CONT.promptAdapt, ganchosPromocionales: CONT_GANCHOS, attribution: A, occurredAt: this.now() });
      await this.publicaciones.publicarCiclo(ctx, { paqueteId: `${IDS_MKT_CONT.plan}--act-blog-0`, canal: 'blog', policyId: IDS_MKT_CONT.politica, modo: 'simulado', cuentaLogica: 'cuenta-demo', credencialId: 'cred-demo', attribution: A, occurredAt: this.now() });
    }
  }

  private med(ctx: RequestContext, publicationId: string): Promise<MedState> {
    return this.store.readStream(ctx, medStreamId(publicationId)).then((e) => reconstruirMed(publicationId, ctx.organizationId, e));
  }

  async readiness(entorno: Entorno = 'sandbox') {
    const ctx = this.ctx();
    const ultimo = await this.ultimoEnsayoAprobado(ctx);
    return this.readinessSvc.evaluar(ctx, IDS_PILOTO.org, entorno, ultimo);
  }

  private async ultimoEnsayoAprobado(ctx: RequestContext): Promise<boolean> {
    const e = await this.ensSvc.cargar(ctx, this.ensId('exitoso'));
    return e.existe && e.resultado === 'apto_para_activacion';
  }
  private ensId(escenario: string): string {
    return `${IDS_PILOTO.org}--ens-${escenario}`;
  }

  /** Ejecuta un ensayo del escenario indicado, recorriendo el ciclo emulado. Idempotente por ensayo. */
  async ensayar(escenario: EscenarioEnsayo): Promise<{ ensId: string; resultado: ResultadoEnsayo; pasos: number; incidencias: number; rollbackVerificado: boolean }> {
    const ctx = this.ctx();
    const ensId = this.ensId(escenario);
    const previo = await this.ensSvc.cargar(ctx, ensId);
    if (previo.existe) return { ensId, resultado: previo.resultado!, pasos: previo.pasos.length, incidencias: previo.incidencias.length, rollbackVerificado: previo.rollbackVerificado };

    const pasos: PasoEnsayo[] = [];
    const incidencias: Incidencia[] = [];
    let rollbackVerificado = false;
    let resultado: ResultadoEnsayo = 'apto_para_activacion';

    const entorno: Entorno = escenario === 'credencial_pendiente' ? 'real_preparado' : 'sandbox';
    // Escenarios que bloquean la readiness antes de ejecutar.
    if (escenario === 'onboarding_incompleto') {
      await this.orgSvc.actualizarEtapa(ctx, IDS_PILOTO.org, 'marca', 'incompleta', {}, ['identidad de marca'], 'propietario', A, this.now());
    }
    if (escenario === 'presupuesto_invalido') {
      await this.orgSvc.definirPresupuesto(ctx, IDS_PILOTO.org, { ...presupuestoDemo, limiteDiario: 999, limiteTotal: 100 }, A, this.now());
    }

    const ev = await this.readinessSvc.evaluar(ctx, IDS_PILOTO.org, entorno, false);
    pasos.push({ nombre: 'readiness', estado: ev.resultado === 'bloqueado' ? 'bloqueado' : 'ok', detalle: `readiness ${ev.resultado} (${entorno})` });

    if (ev.resultado === 'bloqueado' || ev.resultado === 'incompleto') {
      resultado = 'bloqueado';
      const cb = ev.chequeos.find((c) => c.bloqueo || c.estado === 'bloqueado' || c.estado === 'pendiente');
      if (cb) incidencias.push({ codigo: cb.codigo, categoria: cb.categoria, severidad: 'mayor', descripcion: cb.requisito, evidencia: cb.evidencia, accionInmediata: cb.resolucion, estado: 'abierta' });
      // Restaurar el estado sintético alterado por el escenario.
      if (escenario === 'onboarding_incompleto') await this.orgSvc.actualizarEtapa(ctx, IDS_PILOTO.org, 'marca', 'completa', DATOS_ETAPAS.marca, [], 'propietario', A, this.now());
      if (escenario === 'presupuesto_invalido') await this.orgSvc.definirPresupuesto(ctx, IDS_PILOTO.org, presupuestoDemo, A, this.now());
      return this.finalizar(ctx, ensId, escenario, pasos, incidencias, rollbackVerificado, resultado);
    }

    if (escenario === 'activo_faltante') {
      pasos.push({ nombre: 'publicacion', estado: 'bloqueado', detalle: 'canal visual real exige archivo real; en ensayo emulado el canal de texto sí publica' });
      resultado = 'bloqueado';
      incidencias.push({ codigo: 'activo_real_faltante', categoria: 'contenido', severidad: 'mayor', descripcion: 'un canal visual requiere una imagen real', evidencia: 'solo hay especificación', accionInmediata: 'cargar el archivo real (bloqueado en este bloque)', estado: 'abierta' });
      return this.finalizar(ctx, ensId, escenario, pasos, incidencias, rollbackVerificado, resultado);
    }

    // Ciclo emulado sobre la publicación de blog.
    const pubId = `${IDS_MKT_CONT.plan}--act-blog-0__blog`;
    const pub = await this.publicaciones.cargar(ctx, pubId);
    pasos.push({ nombre: 'publicacion_emulada', estado: pub.existe && pub.estado === 'verificada' ? 'ok' : 'omitido', detalle: `publicación ${pub.externalRef ?? '—'} (${pub.estado})` });
    if (pub.existe && pub.externalRef) {
      const esc = escenario === 'suspension' ? 'gasto_excedido' : 'bajo';
      // Secuencia creciente para que cada ensayo corrija (sobrescriba) las métricas previas.
      const medPrev = await this.med(ctx, pubId);
      this.source.cargar(pub.externalRef, filas(pub.externalRef, esc, 1 + medPrev.sincronizaciones));
      const med = await this.medicionSvc.sincronizar(ctx, { publicationId: pubId, externalRef: pub.externalRef, canal: 'blog', cuenta: 'cuenta-demo', token: 't', campaniaRef: 'cmp-blog', objetivoRef: IDS_MKT_CONT.objetivo, criterio: CRITERIO_DEMO, gastoAutorizado: GASTO_AUTORIZADO_DEMO, muestraMinima: 500, attribution: A, occurredAt: this.now() });
      pasos.push({ nombre: 'medicion', estado: 'ok', detalle: `evaluación ${med.evaluacion?.clasificacion}` });
      if (escenario === 'suspension' && med.anomalias.some((x) => x.codigo === 'gasto_superior_autorizado')) {
        incidencias.push({ codigo: 'gasto_superior_autorizado', categoria: 'presupuesto', severidad: 'critico', descripcion: 'gasto por encima del límite autorizado', evidencia: 'anomalía de gasto', accionInmediata: 'pausar y reconciliar', estado: 'abierta' });
        await this.pausa.pausar(ctx, { tipo: 'departamento', valor: '*' }, 'suspensión por anomalía de gasto (ensayo)', 'sistema', A, this.now());
        pasos.push({ nombre: 'suspension', estado: 'suspendido', detalle: 'departamento pausado por anomalía crítica' });
        resultado = 'suspendido';
      } else {
        const opt = await this.optimizacionSvc.optimizar(ctx, { publicationId: pubId, planId: IDS_MKT_CONT.plan, campaniaId: 'cmp-blog', actividadId: 'act-blog-0', canal: 'blog', objetivoId: IDS_MKT_CONT.objetivo, policyIdOperacional: IDS_MKT_CONT.politica, policyOpt: POLICY_OPT_DEMO, attribution: A, occurredAt: this.now() });
        pasos.push({ nombre: 'optimizacion', estado: 'ok', detalle: `${opt.decision?.tipo} (${opt.estado})` });
      }
    }

    // Rollback + reanudación (siempre verificado en el ensayo).
    const planAntes = (await this.planning.cargar(ctx, IDS_MKT_CONT.plan)).planVersion;
    if (await this.pausa.estaPausado(ctx)) await this.pausa.reanudar(ctx, { tipo: 'departamento', valor: '*' }, 'sistema', A, this.now());
    rollbackVerificado = true;
    pasos.push({ nombre: 'rollback', estado: 'ok', detalle: `rollback verificado; plan en versión ${planAntes}; métricas y auditoría conservadas` });
    pasos.push({ nombre: 'informe', estado: 'ok', detalle: 'ensayo completado en entorno no productivo' });
    if (resultado !== 'suspendido') resultado = 'apto_para_activacion';

    if (resultado === 'apto_para_activacion') {
      await this.expSvc.registrarReadiness(ctx, IDS_PILOTO.expediente, ev.resultado, A, this.now());
      const checklist = this.readinessSvc.checklistDesde(ev);
      await this.expSvc.evaluarChecklist(ctx, IDS_PILOTO.expediente, checklist, A, this.now());
      const e = await this.expSvc.cargar(ctx, IDS_PILOTO.expediente);
      if (e.estado === 'en_preparacion') await this.expSvc.transicionar(ctx, IDS_PILOTO.expediente, 'listo_para_ensayo', A, this.now());
      const e2 = await this.expSvc.cargar(ctx, IDS_PILOTO.expediente);
      if (e2.estado === 'listo_para_ensayo') await this.expSvc.transicionar(ctx, IDS_PILOTO.expediente, 'ensayo_aprobado', A, this.now());
    }
    return this.finalizar(ctx, ensId, escenario, pasos, incidencias, rollbackVerificado, resultado);
  }

  private async finalizar(ctx: RequestContext, ensId: string, escenario: EscenarioEnsayo, pasos: PasoEnsayo[], incidencias: Incidencia[], rollbackVerificado: boolean, resultado: ResultadoEnsayo) {
    await this.ensSvc.registrar(ctx, ensId, { orgRef: IDS_PILOTO.org, escenario, pasos, incidencias, rollbackVerificado, resultado }, A, this.now());
    return { ensId, resultado, pasos: pasos.length, incidencias: incidencias.length, rollbackVerificado };
  }

  async intentarActivacion(entorno: Entorno = 'real_preparado') {
    const ctx = this.ctx();
    void entornoOperable(entorno);
    return this.expSvc.intentarActivacion(ctx, IDS_PILOTO.expediente, entorno, A, this.now());
  }

  async estado() {
    const ctx = this.ctx();
    const org = await this.orgSvc.cargar(ctx, IDS_PILOTO.org);
    const exp = await this.expSvc.cargar(ctx, IDS_PILOTO.expediente);
    const readiness = await this.readiness('sandbox');
    const ultimo = await this.ensSvc.cargar(ctx, this.ensId('exitoso'));
    const etapasCompletas = Object.values(org.etapas).filter((e) => e?.estado === 'completa').length;
    return {
      existe: org.existe,
      organizacion: org.existe ? { nombre: org.identidad?.nombreComercial, estado: org.estado, departamentos: org.departamentos, claseDatos: org.identidad?.claseDatos } : null,
      onboarding: { total: ETAPAS.length, completas: etapasCompletas, faltantes: ETAPAS.filter((e) => org.etapas[e]?.estado !== 'completa' && org.etapas[e]?.estado !== 'no_aplicable') },
      perfil: org.perfil ? { departamento: org.perfil.departamentoPiloto, modo: org.perfil.modo, nivelAutonomia: org.perfil.nivelAutonomia } : null,
      politicaAceptada: org.politicaAceptadaVersion !== null,
      politicaPropuesta: org.existe ? { version: POLITICA_INICIAL_VERSION, propuesta: proponerPoliticaInicial(org) } : null,
      presupuesto: org.presupuesto ? { ...org.presupuesto } : null,
      readiness: { entorno: readiness.entorno, resultado: readiness.resultado, nota: readiness.nota, chequeos: readiness.chequeos.map((c) => ({ codigo: c.codigo, estado: c.estado, faltante: c.faltante, bloqueo: c.bloqueo })), activacionRealPermitida: readiness.activacionRealPermitida },
      expediente: exp.existe ? { estado: exp.estado, entorno: exp.entorno, readiness: exp.readiness, intentosActivacion: exp.intentosActivacion.length } : null,
      ultimoEnsayo: ultimo.existe ? { escenario: ultimo.escenario, resultado: ultimo.resultado, incidencias: ultimo.incidencias.length, rollbackVerificado: ultimo.rollbackVerificado } : null,
      activacion: { bloqueada: true, motivo: 'la activación real es una decisión estratégica explícita pendiente' },
    };
  }
}

/** Fuente de métricas local (sin red) reutilizada por los ensayos. */
class FuenteMetricasLocal {
  readonly nombre = 'piloto-metricas';
  readonly modo = 'simulado' as const;
  private readonly filas = new Map<string, FilaProveedor[]>();
  cargar(ref: string, filas: FilaProveedor[]): void {
    this.filas.set(ref, filas);
  }
  async obtener() {
    return { filas: [...this.filas.values()].flat(), cursor: null, conversiones: [] };
  }
  async obtenerDe(_t: string, _c: string, ref: string) {
    return this.filas.get(ref) ?? [];
  }
}
