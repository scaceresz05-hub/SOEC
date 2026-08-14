/**
 * Decisión del PRIMER PILOTO REAL (F2-PILOT-DEC-01). Registra la configuración estratégica
 * APROBADA por el propietario como un expediente en modo `real_preparado`, y DEMUESTRA que la
 * readiness real permanece BLOQUEADA. NINGÚN efecto real ocurre aquí: no se conecta ninguna
 * cuenta, no se publica, no se gasta.
 *
 * MULTIEMPRESA (D-2): esta experiencia YA NO fija la organización en código. Recibe:
 *   - la ORGANIZACIÓN autenticada (clave de tenant) — gobierna el aislamiento de los streams;
 *   - la CONFIGURACIÓN de decisión de piloto de esa organización (`businessKey`, `expedienteId`,
 *     nombre comercial), resuelta desde el registro de negocios.
 *
 * `businessKey` (p. ej. `smileflow-clinic`) es el identificador del NEGOCIO dentro del dominio
 * `@soec/piloto`; NO es una clave de tenant y no puede usarse como tal.
 *
 * Alcance honesto: el CONTENIDO del expediente (identidad, perfil, presupuesto, criterios) sigue
 * siendo la configuración registrada de SmileFlow. Una segunda organización requerirá su propia
 * configuración; hasta entonces, el registro no habilita esta experiencia para nadie más.
 */
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import {
  OrganizacionService,
  ReadinessService,
  ExpedienteService,
  proponerPoliticaInicial,
  identidadSmileFlow,
  perfilSmileFlow,
  presupuestoSmileFlow,
  conexionLinkedinPendiente,
  criteriosExitoSmileFlow,
  criteriosSuspensionSmileFlow,
  rollbackSmileFlow,
  DATOS_ETAPAS_SMILEFLOW,
  PROHIBICIONES_SMILEFLOW,
} from '@soec/piloto';

import type { ConfiguracionDecisionPiloto } from './plataforma';

const A: Attribution = {
  source: 'decision-piloto',
  purpose: 'registrar la decisión del primer piloto real',
  assumptions: [
    'decisión estratégica del propietario; activación real bloqueada; sin efecto/gasto real',
  ],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};

export class PilotDecisionExperience {
  private readonly orgSvc: OrganizacionService;
  private readonly readinessSvc: ReadinessService;
  private readonly expSvc: ExpedienteService;

  /**
   * @param org  clave de TENANT autenticada (autoridad del aislamiento).
   * @param cfg  configuración de decisión de piloto de ESA organización (desde el registro).
   */
  constructor(
    store: EventStore,
    private readonly org: string,
    private readonly cfg: ConfiguracionDecisionPiloto,
  ) {
    this.orgSvc = new OrganizacionService(store);
    this.readinessSvc = new ReadinessService(store);
    this.expSvc = new ExpedienteService(store);
  }
  private ctx(): RequestContext {
    const organizationId = OrganizationId(this.org);
    return {
      organizationId,
      actor: ActorId('propietario'),
      scope: { organizationId, permissions: ['events:append', 'events:read'] },
      correlationId: `dec-${this.org}`,
    };
  }
  private now(): string {
    return new Date().toISOString();
  }

  /** Registra la decisión aprobada (idempotente). No activa nada: prepara el expediente en real_preparado. */
  async preparar(): Promise<void> {
    const ctx = this.ctx();
    const org = await this.orgSvc.cargar(ctx, this.cfg.businessKey);
    if (org.existe) return;
    await this.orgSvc.registrar(
      ctx,
      this.cfg.businessKey,
      identidadSmileFlow,
      ['marketing'],
      A,
      this.now(),
    );
    for (const [etapa, d] of Object.entries(DATOS_ETAPAS_SMILEFLOW)) {
      if (!d) continue;
      await this.orgSvc.actualizarEtapa(
        ctx,
        this.cfg.businessKey,
        etapa as never,
        d.estado,
        d.datos,
        d.faltantes,
        'propietario',
        A,
        this.now(),
      );
    }
    await this.orgSvc.definirPerfil(ctx, this.cfg.businessKey, perfilSmileFlow, A, this.now());
    await this.orgSvc.definirPresupuesto(
      ctx,
      this.cfg.businessKey,
      presupuestoSmileFlow,
      A,
      this.now(),
    );
    await this.orgSvc.declararConexion(
      ctx,
      this.cfg.businessKey,
      conexionLinkedinPendiente,
      A,
      this.now(),
    );
    await this.orgSvc.aceptarPolitica(ctx, this.cfg.businessKey, 1, A, this.now());
    await this.expSvc.crear(
      ctx,
      this.cfg.expedienteId,
      {
        orgRef: this.cfg.businessKey,
        departamento: 'marketing',
        entorno: 'real_preparado',
        objetivo:
          'obtener solicitudes calificadas de demostración de SmileFlow Clinic desde contenido orgánico de LinkedIn (14 días)',
        duracionDias: perfilSmileFlow.duracionDias,
        criteriosExito: criteriosExitoSmileFlow,
        criteriosSuspension: criteriosSuspensionSmileFlow,
        rollback: [...rollbackSmileFlow],
      },
      A,
      this.now(),
    );
  }

  async estado() {
    const ctx = this.ctx();
    const org = await this.orgSvc.cargar(ctx, this.cfg.businessKey);
    const exp = await this.expSvc.cargar(ctx, this.cfg.expedienteId);
    const evReal = await this.readinessSvc.evaluar(
      ctx,
      this.cfg.businessKey,
      'real_preparado',
      false,
    );
    const evSandbox = await this.readinessSvc.evaluar(ctx, this.cfg.businessKey, 'sandbox', false);
    // El expediente de activación: exactamente qué falta (siempre bloqueado).
    const activacion = await this.expSvc.intentarActivacion(
      ctx,
      this.cfg.expedienteId,
      'real_preparado',
      A,
      this.now(),
    );
    return {
      existe: org.existe,
      organizationId: this.org,
      empresa: this.cfg.nombreComercial,
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
      presupuesto: org.presupuesto
        ? { publicidad: org.presupuesto.publicidad, ejecutadoReal: org.presupuesto.ejecutadoReal }
        : null,
      readinessReal: {
        resultado: evReal.resultado,
        nota: evReal.nota,
        bloqueos: evReal.chequeos
          .filter((c) => c.bloqueo || c.estado === 'bloqueado' || c.estado === 'pendiente')
          .map((c) => ({ codigo: c.codigo, estado: c.estado, faltante: c.faltante })),
        activacionRealPermitida: evReal.activacionRealPermitida,
      },
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
    return this.expSvc.intentarActivacion(
      this.ctx(),
      this.cfg.expedienteId,
      'real_preparado',
      A,
      this.now(),
    );
  }
}
