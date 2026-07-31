/**
 * Experiencia «Director Autónomo · Programas» — CABLEA la configuración de programas por negocio
 * (`@soec/programas`) al runtime real. Aditiva: no reemplaza los 4 endpoints del ciclo demo fijo.
 * Registra negocios, define programas (segmentos, hipótesis, campañas, contenido, presupuesto
 * simulado) y opera el ciclo autónomo SIMULADO sobre esa configuración, sobre el `EventStore`
 * real. Autonomía/PAUSA a nivel de organización (V1). Sin efectos externos reales.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { AutonomiaService } from '@soec/autonomia';
import {
  NegocioConfigService,
  ProgramaService,
  CicloProgramaService,
  reconstruirVistaPrograma,
  type EntradaNegocio,
  type EntradaCrearPrograma,
  type EntradaVincularCampania,
  type Hipotesis,
  type PerfilComercial,
  type Segmento,
  type VistaPrograma,
  type EntradaContenido,
} from '@soec/programas';

const ATRIBUCION: Attribution = {
  source: 'director-autonomo-programas',
  purpose: 'configurar y operar programas de marketing por negocio (simulado)',
  assumptions: ['ejecución simulada; sin efectos externos reales'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

export class DirectorAutonomoProgramasExperience {
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock,
  ) {}

  private ctx(org: string): RequestContext {
    const organizationId = OrganizationId(org);
    return { organizationId, actor: ActorId('director'), scope: { organizationId, permissions: ['events:append', 'events:read'] }, correlationId: `dap-${org}` };
  }

  // ── Negocio / organizaciones ────────────────────────────────────────────────────────────────
  async registrarNegocio(org: string, entrada: EntradaNegocio, perfil?: PerfilComercial): Promise<unknown> {
    const svc = new NegocioConfigService(this.store);
    await svc.registrar(this.ctx(org), entrada, ATRIBUCION, this.clock.now());
    if (perfil) await svc.actualizarPerfil(this.ctx(org), perfil, ATRIBUCION, this.clock.now());
    return svc.cargar(this.ctx(org));
  }
  async listarOrganizaciones(): Promise<unknown> {
    // El registro es global; se consulta con un contexto de sistema.
    return new NegocioConfigService(this.store).listarOrganizaciones(this.ctx('_registro'));
  }
  async cargarNegocio(org: string): Promise<unknown> {
    return new NegocioConfigService(this.store).cargar(this.ctx(org));
  }

  // ── Programas ───────────────────────────────────────────────────────────────────────────────
  async crearPrograma(org: string, programaId: string, entrada: EntradaCrearPrograma): Promise<unknown> {
    return new ProgramaService(this.store).crear(this.ctx(org), programaId, entrada, ATRIBUCION, this.clock.now());
  }
  async listarProgramas(org: string): Promise<unknown> {
    return new ProgramaService(this.store).listar(this.ctx(org));
  }
  async estadoPrograma(org: string, programaId: string): Promise<VistaPrograma | null> {
    return reconstruirVistaPrograma(this.store, this.ctx(org), programaId);
  }
  async agregarSegmento(org: string, programaId: string, segmento: Segmento): Promise<unknown> {
    return new ProgramaService(this.store).agregarSegmento(this.ctx(org), programaId, segmento, ATRIBUCION, this.clock.now());
  }
  async agregarHipotesis(org: string, programaId: string, hipotesis: Hipotesis): Promise<unknown> {
    return new ProgramaService(this.store).agregarHipotesis(this.ctx(org), programaId, hipotesis, ATRIBUCION, this.clock.now());
  }
  async vincularCampania(org: string, programaId: string, cmd: EntradaVincularCampania): Promise<unknown> {
    return new ProgramaService(this.store).vincularCampania(this.ctx(org), programaId, cmd, ATRIBUCION, this.clock.now());
  }
  async vincularContenido(org: string, programaId: string, campaignId: string, entrada: EntradaContenido): Promise<unknown> {
    return new ProgramaService(this.store).vincularContenido(this.ctx(org), programaId, campaignId, entrada, ATRIBUCION, this.clock.now());
  }
  async marcarListo(org: string, programaId: string): Promise<unknown> {
    return new ProgramaService(this.store).marcarListo(this.ctx(org), programaId, ATRIBUCION, this.clock.now());
  }

  // ── Ciclo + modo seguro (autonomía por organización) ────────────────────────────────────────
  async ejecutarCiclo(org: string, programaId: string): Promise<VistaPrograma> {
    return new CicloProgramaService(this.store).ejecutarCiclo(this.ctx(org), programaId, ATRIBUCION, this.clock.now());
  }
  async pausar(org: string, programaId: string, motivo: string): Promise<VistaPrograma | null> {
    await new AutonomiaService(this.store).pausar(this.ctx(org), motivo || 'pausa del programa', ATRIBUCION, this.clock.now());
    return this.estadoPrograma(org, programaId);
  }
  async reanudar(org: string, programaId: string, actorHumano: string, motivo: string): Promise<VistaPrograma | null> {
    await new AutonomiaService(this.store).reanudar(this.ctx(org), actorHumano, motivo || 'reanudación del programa', ATRIBUCION, this.clock.now());
    return this.estadoPrograma(org, programaId);
  }
}
