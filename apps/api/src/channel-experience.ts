/**
 * Experiencia del plano de canales (F2-CHAN-01). Siembra el pipeline sintético
 * (marca + prompts + plan + fábrica de contenido), y conduce la publicación
 * CONTROLADA: preparar → autorizar (plano operacional) → adaptador → proveedor
 * emulado/simulado → verificación → reconciliación → auditoría. Modo `simulado` por
 * defecto; `sandbox` usa el proveedor emulado por HTTP. El modo `real` está
 * DESACTIVADO. Ningún efecto público real; sin gasto; sin credenciales reales.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
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
  AdaptadorCanalEmulado,
  AdaptadorCanalSimulado,
  FixtureCredentialProvider,
  PublicationService,
  WebhookService,
  type AdaptadorCanal,
  type ModoPublicacion,
  type PublicationState,
  type WebhookEntrante,
} from '@soec/canales';

const ORG = 'pyme-chan-demo';
const CUENTA = 'cuenta-demo';
const CRED = 'cred-demo';
const CANALES = ['blog', 'linkedin', 'instagram', 'correo', 'meta_ads', 'facebook'];
const ATRIBUCION: Attribution = {
  source: 'experiencia-canales',
  purpose: 'publicar contenido autorizado por política en un proveedor emulado',
  assumptions: ['proveedor emulado/simulado; ningún efecto público real; sin credenciales reales'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};

export interface PublicacionResumen {
  publicationId: string;
  canal: string;
  modo: string;
  estado: string;
  motivoBloqueo: string | null;
  externalRef: string | null;
  estadoRemoto: string | null;
  intentos: { intentoId: number; resultado: string; mensaje: string }[];
  reconciliaciones: { tipo: string; resolucion: string; requiereIntervencion: boolean }[];
  requiereIntervencion: boolean;
}
export interface ActividadCanal {
  id: string;
  canal: string;
  paqueteEstado: string | null;
  publicable: boolean;
  publicacion: PublicacionResumen | null;
}
export interface EstadoCanales {
  existe: boolean;
  empresa: string;
  modo: ModoPublicacion;
  modosDisponibles: string[];
  actividades: ActividadCanal[];
}

const PAQUETE_PUBLICABLE = new Set(['listo', 'autorizado', 'entregado', 'ejecutado', 'verificado']);

export class ChannelExperience {
  private readonly policies: PolicyService;
  private readonly objetivos: ObjectiveService;
  private readonly planning: PlanningService;
  private readonly marcas: MarcaService;
  private readonly prompts: PromptService;
  private readonly content: ContentService;
  private readonly publicaciones: PublicationService;
  private readonly webhookSvc: WebhookService;
  private readonly modoDefecto: ModoPublicacion;

  constructor(store: EventStore, emuUrl?: string) {
    const operational = new OperationalService(store, [new AdaptadorSimulado()]);
    this.policies = new PolicyService(store);
    this.objetivos = new ObjectiveService(store);
    this.planning = new PlanningService(store, operational);
    this.marcas = new MarcaService(store);
    this.prompts = new PromptService(store);
    this.content = new ContentService(store, new ProveedorGenerativoDeterminista(), this.planning);
    const creds = new FixtureCredentialProvider();
    creds.registrarTodosLosCanales(ORG, CUENTA, CRED, CANALES);
    const simulado = new AdaptadorCanalSimulado();
    const sandbox: AdaptadorCanal = emuUrl ? new AdaptadorCanalEmulado(emuUrl) : simulado;
    this.modoDefecto = emuUrl ? 'sandbox' : 'simulado';
    this.publicaciones = new PublicationService(store, { simulado, sandbox }, creds, this.content);
    this.webhookSvc = new WebhookService(store, this.publicaciones);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions: ['events:append', 'events:read'] }, correlationId: `exp-chan-${ORG}` };
  }
  private now(): string {
    return new Date().toISOString();
  }
  private paqueteId(actividadId: string): string {
    return `${IDS_MKT_CONT.plan}--${actividadId}`;
  }

  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    if (!plan.existe) {
      const rm = await this.marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, ATRIBUCION, this.now());
      await this.marcas.publicar(ctx, IDS_CONT.marca, rm.version, ATRIBUCION, this.now());
      const rp1 = await this.prompts.registrarVersion(ctx, IDS_CONT.promptPieza, promptPiezaDemo, ATRIBUCION, this.now());
      await this.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, ATRIBUCION, this.now());
      const rp2 = await this.prompts.registrarVersion(ctx, IDS_CONT.promptAdapt, promptAdaptDemo, ATRIBUCION, this.now());
      await this.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, ATRIBUCION, this.now());
      await this.objetivos.registrar(ctx, IDS_MKT_CONT.objetivo, objetivoContenidoDemo, ATRIBUCION, this.now());
      const rpol = await this.policies.registrarVersion(ctx, IDS_MKT_CONT.politica, politicaContenidoDemo, ATRIBUCION, this.now());
      await this.policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, ATRIBUCION, this.now());
      await this.planning.generarPlan(ctx, { planId: IDS_MKT_CONT.plan, objetivoId: IDS_MKT_CONT.objetivo, policyId: IDS_MKT_CONT.politica, fechaInicio: this.now(), opts: optsContenidoDemo, attribution: ATRIBUCION, occurredAt: this.now() });
    }
    // Producir contenido para las actividades bloqueadas por falta de contenido.
    const actual = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    for (const a of Object.values(actual.actividades)) {
      if (a.estado === 'bloqueada' && a.motivoBloqueo === 'contenido_faltante') {
        await this.content.prepararContenidoParaActividad(ctx, { planId: IDS_MKT_CONT.plan, actividadId: a.id, marcaId: IDS_CONT.marca, promptPiezaId: IDS_CONT.promptPieza, promptAdaptId: IDS_CONT.promptAdapt, ganchosPromocionales: CONT_GANCHOS, attribution: ATRIBUCION, occurredAt: this.now() });
      }
    }
  }

  private resumen(p: PublicationState): PublicacionResumen {
    return {
      publicationId: p.publicationId,
      canal: p.canal,
      modo: p.modo,
      estado: p.estado,
      motivoBloqueo: p.motivoBloqueo,
      externalRef: p.externalRef,
      estadoRemoto: p.estadoRemoto,
      intentos: p.intentos.map((i) => ({ intentoId: i.intentoId, resultado: i.resultado, mensaje: i.mensaje })),
      reconciliaciones: p.reconciliaciones.map((r) => ({ tipo: r.tipo, resolucion: r.resolucion, requiereIntervencion: r.requiereIntervencion })),
      requiereIntervencion: p.requiereIntervencion,
    };
  }

  async estado(): Promise<EstadoCanales> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    const actividades: ActividadCanal[] = [];
    for (const a of Object.values(plan.actividades).sort((x, y) => x.canal.localeCompare(y.canal))) {
      const paquete = await this.content.cargarPaquete(ctx, this.paqueteId(a.id));
      const pub = await this.publicaciones.cargar(ctx, `${this.paqueteId(a.id)}__${a.canal}`);
      actividades.push({
        id: a.id,
        canal: a.canal,
        paqueteEstado: paquete.existe ? paquete.estado : null,
        publicable: paquete.existe && PAQUETE_PUBLICABLE.has(paquete.estado),
        publicacion: pub.existe ? this.resumen(pub) : null,
      });
    }
    return { existe: plan.existe, empresa: objetivoContenidoDemo.empresa, modo: this.modoDefecto, modosDisponibles: ['simulado', 'sandbox', 'real_desactivado'], actividades };
  }

  private cmd(actividadId: string, canal: string, modo: ModoPublicacion) {
    return { paqueteId: this.paqueteId(actividadId), canal, policyId: IDS_MKT_CONT.politica, modo, cuentaLogica: CUENTA, credencialId: CRED, attribution: ATRIBUCION, occurredAt: this.now() };
  }

  async publicar(actividadId: string, canal: string, modo?: ModoPublicacion): Promise<PublicacionResumen> {
    const r = await this.publicaciones.publicarCiclo(this.ctx(), this.cmd(actividadId, canal, modo ?? this.modoDefecto));
    return this.resumen(r);
  }

  async publicarTodo(modo?: ModoPublicacion): Promise<{ publicadas: number; verificadas: number; bloqueadas: number }> {
    const ctx = this.ctx();
    const plan = await this.planning.cargar(ctx, IDS_MKT_CONT.plan);
    let publicadas = 0;
    let verificadas = 0;
    let bloqueadas = 0;
    for (const a of Object.values(plan.actividades)) {
      const paquete = await this.content.cargarPaquete(ctx, this.paqueteId(a.id));
      if (!paquete.existe || !PAQUETE_PUBLICABLE.has(paquete.estado)) continue;
      const r = await this.publicaciones.publicarCiclo(ctx, this.cmd(a.id, a.canal, modo ?? this.modoDefecto));
      publicadas += 1;
      if (r.estado === 'verificada') verificadas += 1;
      if (r.estado === 'bloqueada') bloqueadas += 1;
    }
    return { publicadas, verificadas, bloqueadas };
  }

  async retirar(actividadId: string, canal: string): Promise<PublicacionResumen> {
    const r = await this.publicaciones.retirar(this.ctx(), `${this.paqueteId(actividadId)}__${canal}`, 'retiro desde el centro de control', ATRIBUCION, this.now());
    return this.resumen(r);
  }

  async webhook(wh: WebhookEntrante): Promise<{ resultado: string; motivo: string }> {
    return this.webhookSvc.procesar(this.ctx(), wh, ATRIBUCION, this.now());
  }
}
