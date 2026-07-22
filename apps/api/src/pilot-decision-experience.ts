/**
 * Decisión del PRIMER PILOTO REAL — SmileFlow Clinic (F2-PILOT-DEC-01). Registra la
 * configuración estratégica APROBADA por el propietario como un expediente en modo
 * `real_preparado`, y DEMUESTRA que la readiness real permanece BLOQUEADA (falta una
 * credencial real verificada y la cuenta real de LinkedIn). Produce el expediente exacto
 * de las autorizaciones estratégicas y operativas que el propietario aún debe proveer.
 * NINGÚN efecto real ocurre aquí: no se conecta ninguna cuenta, no se publica, no se gasta.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  OrganizacionService, ReadinessService, ExpedienteService,
  proponerPoliticaInicial,
  IDS_SMILEFLOW, identidadSmileFlow, perfilSmileFlow, presupuestoSmileFlow, conexionLinkedinPendiente,
  criteriosExitoSmileFlow, criteriosSuspensionSmileFlow, rollbackSmileFlow, DATOS_ETAPAS_SMILEFLOW, PROHIBICIONES_SMILEFLOW,
} from '@soec/piloto';

const ORG = 'smileflow-clinic';
const A: Attribution = { source: 'decision-piloto', purpose: 'registrar la decisión del primer piloto real (SmileFlow)', assumptions: ['decisión estratégica del propietario; activación real bloqueada; sin efecto/gasto real'], claimType: 'observational', regime: 'institutional', uncertainty: 'baja' };

export class PilotDecisionExperience {
  private readonly orgSvc: OrganizacionService;
  private readonly readinessSvc: ReadinessService;
  private readonly expSvc: ExpedienteService;

  constructor(store: EventStore) {
    this.orgSvc = new OrganizacionService(store);
    this.readinessSvc = new ReadinessService(store);
    this.expSvc = new ExpedienteService(store);
  }
  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return { organizationId, actor: ActorId('propietario'), scope: { organizationId, permissions: ['events:append', 'events:read'] }, correlationId: `dec-${ORG}` };
  }
  private now(): string {
    return new Date().toISOString();
  }

  /** Registra la decisión aprobada (idempotente). No activa nada: prepara el expediente en real_preparado. */
  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const org = await this.orgSvc.cargar(ctx, IDS_SMILEFLOW.org);
    if (org.existe) return;
    await this.orgSvc.registrar(ctx, IDS_SMILEFLOW.org, identidadSmileFlow, ['marketing'], A, this.now());
    for (const [etapa, d] of Object.entries(DATOS_ETAPAS_SMILEFLOW)) {
      if (!d) continue;
      await this.orgSvc.actualizarEtapa(ctx, IDS_SMILEFLOW.org, etapa as never, d.estado, d.datos, d.faltantes, 'propietario', A, this.now());
    }
    await this.orgSvc.definirPerfil(ctx, IDS_SMILEFLOW.org, perfilSmileFlow, A, this.now());
    await this.orgSvc.definirPresupuesto(ctx, IDS_SMILEFLOW.org, presupuestoSmileFlow, A, this.now());
    await this.orgSvc.declararConexion(ctx, IDS_SMILEFLOW.org, conexionLinkedinPendiente, A, this.now());
    await this.orgSvc.aceptarPolitica(ctx, IDS_SMILEFLOW.org, 1, A, this.now());
    await this.expSvc.crear(ctx, IDS_SMILEFLOW.expediente, { orgRef: IDS_SMILEFLOW.org, departamento: 'marketing', entorno: 'real_preparado', objetivo: 'obtener solicitudes calificadas de demostración de SmileFlow Clinic desde contenido orgánico de LinkedIn (14 días)', duracionDias: perfilSmileFlow.duracionDias, criteriosExito: criteriosExitoSmileFlow, criteriosSuspension: criteriosSuspensionSmileFlow, rollback: [...rollbackSmileFlow] }, A, this.now());
  }

  async estado() {
    const ctx = this.ctx();
    const org = await this.orgSvc.cargar(ctx, IDS_SMILEFLOW.org);
    const exp = await this.expSvc.cargar(ctx, IDS_SMILEFLOW.expediente);
    const evReal = await this.readinessSvc.evaluar(ctx, IDS_SMILEFLOW.org, 'real_preparado', false);
    const evSandbox = await this.readinessSvc.evaluar(ctx, IDS_SMILEFLOW.org, 'sandbox', false);
    // El expediente de activación: exactamente qué falta (siempre bloqueado).
    const activacion = await this.expSvc.intentarActivacion(ctx, IDS_SMILEFLOW.expediente, 'real_preparado', A, this.now());
    return {
      existe: org.existe,
      empresa: 'SmileFlow Clinic',
      decision: {
        departamento: 'marketing',
        objetivo: exp.objetivo,
        canal: 'linkedin (orgánico)',
        modo: 'real_preparado',
        nivelAutonomia: perfilSmileFlow.nivelAutonomia,
        aprobacionPorPublicacion: true,
        frecuenciaMaxima: perfilSmileFlow.frecuenciaMaxima,
        duracionDias: perfilSmileFlow.duracionDias,
        gastoPublicitario: 0,
        prohibiciones: PROHIBICIONES_SMILEFLOW,
        criteriosExito: criteriosExitoSmileFlow.map((c) => c.indicador),
        criteriosSuspension: criteriosSuspensionSmileFlow.map((c) => c.codigo),
      },
      politicaPropuesta: org.existe ? proponerPoliticaInicial(org) : null,
      presupuesto: org.presupuesto ? { publicidad: org.presupuesto.publicidad, ejecutadoReal: org.presupuesto.ejecutadoReal } : null,
      readinessReal: { resultado: evReal.resultado, nota: evReal.nota, bloqueos: evReal.chequeos.filter((c) => c.bloqueo || c.estado === 'bloqueado' || c.estado === 'pendiente').map((c) => ({ codigo: c.codigo, estado: c.estado, faltante: c.faltante })), activacionRealPermitida: evReal.activacionRealPermitida },
      readinessSandbox: { resultado: evSandbox.resultado },
      expediente: exp.existe ? { estado: exp.estado, entorno: exp.entorno } : null,
      activacion: {
        permitida: activacion.permitida,
        motivo: activacion.motivoDenegacion,
        loQueFaltaEstrategico: activacion.autorizacionesFaltantes,
        loQueFaltaOperativo: [
          'declarar la identidad legal de SmileFlow Clinic (nombre legal, país/moneda si difieren)',
          'conectar la cuenta empresarial real de LinkedIn (acción del propietario; SOEC no la conecta)',
          'proveer y verificar una credencial real del canal (referencia; jamás el token)',
          'montar el mecanismo de atribución identificable (UTM + formulario con identificador de campaña)',
          'otorgar la autorización de publicación explícita (aprobación por publicación)',
        ],
      },
    };
  }

  /** Intento de activación: SIEMPRE bloqueado. Devuelve la denegación con lo que falta. */
  async intentarActivar() {
    return this.expSvc.intentarActivacion(this.ctx(), IDS_SMILEFLOW.expediente, 'real_preparado', A, this.now());
  }
}
