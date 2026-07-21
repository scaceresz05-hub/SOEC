/**
 * Capa de experiencia «Comprender el estado de mi empresa» (F1-UI-01).
 *
 * Ejecuta la CADENA REAL (Capacidad → Operaciones → ECE → MED+MDM sintéticos
 * persistidos) y ensambla un DTO orientado a las cinco preguntas humanas, sin
 * exponer terminología interna. Contexto sintético server-side (sin auth). No
 * ejecuta efectos externos; el producto se ofrece al juicio de la persona.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService } from '@soec/ece';
import { OperacionesService, MecanismoDeterministico, MecanismoSimuladoIA, type ProductoIntelectual } from '@soec/operaciones';
import {
  CapabilitiesOrchestrator,
  CapabilityQueryService,
  CapabilityRegistry,
  type ProductoCapacidad,
} from '@soec/capacidades';
import { EceQueryService } from '@soec/ece';
import { IDS, ejecutarComprenderEstado, instanciarPyme } from '@soec/instancia-pyme';

const ORG = 'pyme-demo';
const ACTOR = 'responsable';
const INDEX_STREAM = 'exp:comprender-estado';
const ATRIBUCION: Attribution = {
  source: 'experiencia-web',
  purpose: 'comprender el estado de la pyme para el juicio humano',
  assumptions: ['pyme sintética; ningún dato real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

export interface ProductoOperacionDTO {
  operacion: string;
  abstenido: boolean;
  causaAbstencion: string | null;
  evidencia: readonly string[];
  razones: readonly string[];
  procedencia: string;
  incertidumbre: string;
  faltante: readonly string[];
  limitaciones: readonly string[];
  detalle: ProductoIntelectual;
}

export interface ResultadoExperiencia {
  executionId: string;
  existe: boolean;
  estado: 'compuesta' | 'abstenida' | 'inexistente';
  empresa: string;
  capacidad: { id: string; nombre: string; version: number };
  eceCorte: number | null;
  construidoEn: string | null;
  producto: ProductoCapacidad | null;
  intermedios: ProductoOperacionDTO[];
}

export interface ResumenHistorial {
  executionId: string;
  estado: string;
  terminadoEn: string | null;
  contradicciones: number;
  faltantes: number;
}

export class ExperienciaComprenderEstado {
  private readonly med: MedService;
  private readonly mdm: MdmService;
  private readonly eceBuild: EceBuildService;
  private readonly eceQuery: EceQueryService;
  private readonly registry: CapabilityRegistry;
  private readonly orchestrator: CapabilitiesOrchestrator;
  private readonly capQuery: CapabilityQueryService;
  private readonly operaciones: OperacionesService;

  constructor(private readonly store: EventStore) {
    this.med = new MedService(store);
    this.mdm = new MdmService(store);
    this.eceBuild = new EceBuildService(store, this.med, this.mdm);
    this.eceQuery = new EceQueryService(store, this.med, this.mdm);
    this.operaciones = new OperacionesService(store, this.eceQuery, [new MecanismoDeterministico(), new MecanismoSimuladoIA()]);
    this.registry = new CapabilityRegistry(store);
    this.orchestrator = new CapabilitiesOrchestrator(store, this.registry, this.operaciones);
    this.capQuery = new CapabilityQueryService(store);
  }

  private ctx(): RequestContext {
    const organizationId = OrganizationId(ORG);
    return {
      organizationId,
      actor: ActorId(ACTOR),
      scope: { organizationId, permissions: ['events:append', 'events:read'] },
      correlationId: `exp-${ORG}`,
    };
  }

  private opts() {
    return { attribution: ATRIBUCION, occurredAt: new Date().toISOString() };
  }

  /** Prepara la instancia sintética de la pyme si aún no existe (idempotente). */
  async prepararInstancia(): Promise<void> {
    const med = await this.med.estadoActual(this.ctx(), IDS.med);
    if (!med.existe) {
      await instanciarPyme(this.ctx(), { med: this.med, mdm: this.mdm, eceBuild: this.eceBuild, registry: this.registry }, this.opts());
    }
  }

  private async intermedios(ctx: RequestContext, producto: ProductoCapacidad | null): Promise<ProductoOperacionDTO[]> {
    if (!producto) return [];
    const salida: ProductoOperacionDTO[] = [];
    for (const paso of producto.operacionesEjecutadas) {
      const p = await this.operaciones.producto(ctx, paso.operacionExecutionId);
      if (p) {
        salida.push({
          operacion: p.operacion,
          abstenido: p.abstenido,
          causaAbstencion: p.causaAbstencion,
          evidencia: p.evidencia,
          razones: p.razones,
          procedencia: p.procedencia,
          incertidumbre: p.incertidumbre,
          faltante: p.faltante,
          limitaciones: p.limitaciones,
          detalle: p,
        });
      }
    }
    return salida;
  }

  private async ensamblar(ctx: RequestContext, executionId: string): Promise<ResultadoExperiencia> {
    const ejec = await this.capQuery.ejecucion(ctx, executionId);
    const producto = ejec.producto;
    return {
      executionId,
      existe: ejec.existe,
      estado: ejec.existe ? (ejec.estado as 'compuesta' | 'abstenida') : 'inexistente',
      empresa: 'Pyme de servicios (instancia sintética)',
      capacidad: { id: IDS.capacidad, nombre: producto?.nombre ?? 'Comprender el estado', version: ejec.definicionVersion },
      eceCorte: null,
      construidoEn: ejec.terminadoEn,
      producto,
      intermedios: await this.intermedios(ctx, producto),
    };
  }

  /** Inicia (o recupera) el análisis. Idempotente por executionId. */
  async analizar(executionId: string): Promise<ResultadoExperiencia> {
    await this.prepararInstancia();
    const ctx = this.ctx();
    const nuevo = !(await this.capQuery.ejecucion(ctx, executionId)).existe;
    await ejecutarComprenderEstado(ctx, this.orchestrator, executionId, { ...this.opts(), idempotencyKey: executionId });
    if (nuevo) await this.registrarEnHistorial(ctx, executionId);
    return this.ensamblar(ctx, executionId);
  }

  async detalle(executionId: string): Promise<ResultadoExperiencia> {
    return this.ensamblar(this.ctx(), executionId);
  }

  async historial(): Promise<ResumenHistorial[]> {
    const ctx = this.ctx();
    const ids = await this.leerIndice(ctx);
    const salida: ResumenHistorial[] = [];
    for (const id of ids) {
      const ejec = await this.capQuery.ejecucion(ctx, id);
      if (!ejec.existe) continue;
      salida.push({
        executionId: id,
        estado: ejec.estado ?? 'desconocido',
        terminadoEn: ejec.terminadoEn,
        contradicciones: ejec.producto?.contradiccionesAbiertas.length ?? 0,
        faltantes: ejec.producto?.faltante.length ?? 0,
      });
    }
    return salida.reverse(); // más reciente primero
  }

  private async leerIndice(ctx: RequestContext): Promise<string[]> {
    const events = await this.store.readStream(ctx, INDEX_STREAM);
    return events.map((e) => (e.payload as { executionId: string }).executionId);
  }

  private async registrarEnHistorial(ctx: RequestContext, executionId: string): Promise<void> {
    const events = await this.store.readStream(ctx, INDEX_STREAM);
    await this.store.append(ctx, INDEX_STREAM, events.length, [
      { type: 'exp.analisis_registrado', payload: { executionId }, attribution: ATRIBUCION, occurredAt: new Date().toISOString() },
    ]);
  }
}
