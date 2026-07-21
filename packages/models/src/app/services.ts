/**
 * Capa de aplicación de los Modelos: comandos y consultas.
 *
 * Cada comando exige contexto, valida organización y alcance (vía EventStore),
 * produce eventos con atribución, es idempotente cuando se aporta clave, respeta
 * la concurrencia optimista y rechaza cambios incompatibles. No integra
 * comprensión (eso es el ECE, #12) — solo almacena y organiza representación.
 */
import type { AppendResult, Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  ComandoInvalidoError,
  ModelAlreadyExistsError,
  ModelNotFoundError,
  ModelSeparationError,
  ReferenteInexistenteError,
  TransicionInvalidaError,
} from '../domain/errors';
import {
  type AmbitoDeclarado,
  type EstadoAfirmacion,
  EVENTOS,
  type ModelInstanceState,
  type ModelType,
  type RelacionEvidencia,
  type Vigencia,
  reconstruir,
  streamId,
} from '../domain/model';

/** Nombres de evento comunes a MED y MDM (Simetría, #9 inv. 11). */
interface EventNames {
  readonly creada: string;
  readonly entidad: string;
  readonly entidadModificada: string;
  readonly relacion: string;
  readonly afirmacion: string;
  readonly evidencia: string;
  readonly revision: string;
}

const ESTADOS_VALIDOS: readonly EstadoAfirmacion[] = ['pendiente', 'respaldada', 'cuestionada', 'superada'];

function prefijo(modelType: ModelType): string {
  return `${modelType.toLowerCase()}.`;
}

/** Frontera MED ╪ MDM verificable (§8): un modelo jamás procesa eventos del otro. */
function assertPerteneceAlModelo(modelType: ModelType, tipo: string): void {
  if (!tipo.startsWith(prefijo(modelType))) {
    throw new ModelSeparationError(
      `El evento '${tipo}' no pertenece al modelo ${modelType}: se viola la separación MED ╪ MDM`,
    );
  }
}

export interface ComandoBase {
  readonly instanceId: string;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
}

/** Repositorio de agregados de modelo sobre el EventStore (streams separados por modelo). */
export class ModelRepository {
  constructor(private readonly store: EventStore) {}

  async cargar(ctx: RequestContext, modelType: ModelType, instanceId: string): Promise<ModelInstanceState> {
    const events = await this.store.readStream(ctx, streamId(modelType, instanceId));
    for (const e of events) assertPerteneceAlModelo(modelType, e.type);
    return reconstruir(instanceId, modelType, ctx.organizationId, events);
  }

  async cargarEn(
    ctx: RequestContext,
    modelType: ModelType,
    instanceId: string,
    asOfRecordedAt: string,
  ): Promise<ModelInstanceState> {
    const events = await this.store.reconstructAt(ctx, streamId(modelType, instanceId), asOfRecordedAt);
    for (const e of events) assertPerteneceAlModelo(modelType, e.type);
    return reconstruir(instanceId, modelType, ctx.organizationId, events);
  }

  async emitir(
    ctx: RequestContext,
    modelType: ModelType,
    instanceId: string,
    expectedVersion: number,
    input: EventInput,
  ): Promise<AppendResult> {
    assertPerteneceAlModelo(modelType, input.type); // rechaza eventos ajenos al modelo
    return this.store.append(ctx, streamId(modelType, instanceId), expectedVersion, [input]);
  }
}

/** Servicio común de modelo: realiza la anatomía compartida (#10 §3). */
export class ModelService {
  protected readonly repo: ModelRepository;

  constructor(
    protected readonly store: EventStore,
    protected readonly modelType: ModelType,
    protected readonly ev: EventNames,
  ) {
    this.repo = new ModelRepository(store);
  }

  private buildInput(type: string, payload: unknown, c: ComandoBase): EventInput {
    const input: EventInput = {
      type,
      payload,
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return c.idempotencyKey ? { ...input, idempotencyKey: c.idempotencyKey } : input;
  }

  async crear(
    ctx: RequestContext,
    c: ComandoBase & { ambito: AmbitoDeclarado; vigencia: Vigencia },
  ): Promise<AppendResult> {
    if (!c.ambito?.proposito || !c.ambito?.representa) {
      throw new ComandoInvalidoError('El ámbito declarado exige propósito y qué representa (#9 inv. 2)');
    }
    const estado = await this.repo.cargar(ctx, this.modelType, c.instanceId);
    if (estado.existe) {
      throw new ModelAlreadyExistsError(`La instancia ${this.modelType} '${c.instanceId}' ya existe`);
    }
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(this.ev.creada, { ambito: c.ambito, vigencia: c.vigencia }, c),
    );
  }

  protected async cargarExistente(ctx: RequestContext, instanceId: string): Promise<ModelInstanceState> {
    const estado = await this.repo.cargar(ctx, this.modelType, instanceId);
    if (!estado.existe) {
      throw new ModelNotFoundError(`La instancia ${this.modelType} '${instanceId}' no existe`);
    }
    return estado;
  }

  async registrarEntidad(
    ctx: RequestContext,
    c: ComandoBase & { entidadId: string; dimension: string; tipo: string; atributos: Record<string, unknown> },
  ): Promise<AppendResult> {
    const estado = await this.cargarExistente(ctx, c.instanceId);
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(
        this.ev.entidad,
        { entidadId: c.entidadId, dimension: c.dimension, tipo: c.tipo, atributos: c.atributos },
        c,
      ),
    );
  }

  async modificarEntidad(
    ctx: RequestContext,
    c: ComandoBase & { entidadId: string; atributos?: Record<string, unknown>; vigente?: boolean },
  ): Promise<AppendResult> {
    const estado = await this.cargarExistente(ctx, c.instanceId);
    if (!estado.entidades[c.entidadId]) {
      throw new ReferenteInexistenteError(`La entidad '${c.entidadId}' no existe en ${c.instanceId}`);
    }
    const payload: Record<string, unknown> = { entidadId: c.entidadId };
    if (c.atributos !== undefined) payload['atributos'] = c.atributos;
    if (c.vigente !== undefined) payload['vigente'] = c.vigente;
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(this.ev.entidadModificada, payload, c),
    );
  }

  async registrarRelacionInterna(
    ctx: RequestContext,
    c: ComandoBase & { relId: string; desde: string; hasta: string; naturaleza: string },
  ): Promise<AppendResult> {
    const estado = await this.cargarExistente(ctx, c.instanceId);
    if (!estado.entidades[c.desde] || !estado.entidades[c.hasta]) {
      throw new ReferenteInexistenteError('Ambos extremos de la relación interna deben existir');
    }
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(
        this.ev.relacion,
        { relId: c.relId, desde: c.desde, hasta: c.hasta, naturaleza: c.naturaleza },
        c,
      ),
    );
  }

  async emitirAfirmacion(
    ctx: RequestContext,
    c: ComandoBase & {
      afirmacionId: string;
      enunciado: string;
      dimension: string;
      incertidumbre: string;
      limitacion?: string | null;
    },
  ): Promise<AppendResult> {
    const estado = await this.cargarExistente(ctx, c.instanceId);
    if (!c.enunciado) throw new ComandoInvalidoError('Una afirmación exige enunciado');
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(
        this.ev.afirmacion,
        {
          afirmacionId: c.afirmacionId,
          enunciado: c.enunciado,
          dimension: c.dimension,
          incertidumbre: c.incertidumbre,
          limitacion: c.limitacion ?? null,
        },
        c,
      ),
    );
  }

  async incorporarEvidencia(
    ctx: RequestContext,
    c: ComandoBase & {
      evidenciaId: string;
      afirmacionId: string;
      relacion: RelacionEvidencia;
      procedencia: string;
      contenido: string;
    },
  ): Promise<AppendResult> {
    const estado = await this.cargarExistente(ctx, c.instanceId);
    if (!estado.afirmaciones[c.afirmacionId]) {
      throw new ReferenteInexistenteError(`La afirmación '${c.afirmacionId}' no existe`);
    }
    if (!c.procedencia) {
      throw new ComandoInvalidoError('Toda evidencia debe conservar procedencia (#9 Evidencia)');
    }
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(
        this.ev.evidencia,
        {
          evidenciaId: c.evidenciaId,
          afirmacionId: c.afirmacionId,
          relacion: c.relacion,
          procedencia: c.procedencia,
          contenido: c.contenido,
        },
        c,
      ),
    );
  }

  async revisarAfirmacion(
    ctx: RequestContext,
    c: ComandoBase & {
      afirmacionId: string;
      nuevoEstado: EstadoAfirmacion;
      motivo: string;
      supersededBy?: string | null;
    },
  ): Promise<AppendResult> {
    const estado = await this.cargarExistente(ctx, c.instanceId);
    const af = estado.afirmaciones[c.afirmacionId];
    if (!af) throw new ReferenteInexistenteError(`La afirmación '${c.afirmacionId}' no existe`);
    if (!ESTADOS_VALIDOS.includes(c.nuevoEstado)) {
      throw new TransicionInvalidaError(`Estado de afirmación inválido: ${c.nuevoEstado}`);
    }
    if (!c.motivo) {
      throw new ComandoInvalidoError('La revisión conserva la historia: exige motivo explícito');
    }
    return this.repo.emitir(
      ctx,
      this.modelType,
      c.instanceId,
      estado.version,
      this.buildInput(
        this.ev.revision,
        { afirmacionId: c.afirmacionId, nuevoEstado: c.nuevoEstado, motivo: c.motivo, supersededBy: c.supersededBy ?? null },
        c,
      ),
    );
  }

  estadoActual(ctx: RequestContext, instanceId: string): Promise<ModelInstanceState> {
    return this.repo.cargar(ctx, this.modelType, instanceId);
  }

  estadoHistorico(ctx: RequestContext, instanceId: string, asOfRecordedAt: string): Promise<ModelInstanceState> {
    return this.repo.cargarEn(ctx, this.modelType, instanceId, asOfRecordedAt);
  }
}

/** Servicio del MED (#10). */
export class MedService extends ModelService {
  constructor(store: EventStore) {
    super(store, 'MED', EVENTOS.med);
  }
}

/** Servicio del MDM (#11): añade lo propio del dominio del mundo — observación y cambio autónomo. */
export class MdmService extends ModelService {
  constructor(store: EventStore) {
    super(store, 'MDM', EVENTOS.mdm);
  }

  async registrarObservacion(
    ctx: RequestContext,
    c: ComandoBase & { observacionId: string; entidadId?: string | null; contenido: string },
  ): Promise<AppendResult> {
    const estado = await this.repo.cargar(ctx, 'MDM', c.instanceId);
    if (!estado.existe) throw new ModelNotFoundError(`La instancia MDM '${c.instanceId}' no existe`);
    const input: EventInput = {
      type: EVENTOS.mdm.observacion,
      payload: { observacionId: c.observacionId, entidadId: c.entidadId ?? null, contenido: c.contenido },
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return this.repo.emitir(
      ctx,
      'MDM',
      c.instanceId,
      estado.version,
      c.idempotencyKey ? { ...input, idempotencyKey: c.idempotencyKey } : input,
    );
  }

  async registrarCambioExterno(
    ctx: RequestContext,
    c: ComandoBase & { cambioId: string; entidadId?: string | null; descripcion: string },
  ): Promise<AppendResult> {
    const estado = await this.repo.cargar(ctx, 'MDM', c.instanceId);
    if (!estado.existe) throw new ModelNotFoundError(`La instancia MDM '${c.instanceId}' no existe`);
    const input: EventInput = {
      type: EVENTOS.mdm.cambioExterno,
      payload: { cambioId: c.cambioId, entidadId: c.entidadId ?? null, descripcion: c.descripcion },
      attribution: c.attribution,
      occurredAt: c.occurredAt,
    };
    return this.repo.emitir(
      ctx,
      'MDM',
      c.instanceId,
      estado.version,
      c.idempotencyKey ? { ...input, idempotencyKey: c.idempotencyKey } : input,
    );
  }
}
