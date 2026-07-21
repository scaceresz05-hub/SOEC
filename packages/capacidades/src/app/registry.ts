/**
 * Registro técnico de capacidades (§14).
 *
 * Registra definiciones versionadas, publica versiones, resuelve la vigente,
 * valida operaciones desconocidas y estructura de composición, e IMPIDE ciclos
 * (una capacidad no puede componerse de sí misma, directa o indirectamente).
 * No es el catálogo comercial: no hay marketplace, UI ni editor visual.
 */
import type { AppendResult, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type CapDefState,
  EVENTOS_CAPDEF,
  capdefStreamId,
  reconstruirCapDef,
} from '../domain/aggregate-definition';
import { OPERACIONES_COMPONIBLES, type DefinicionVersion } from '../domain/definition';
import {
  CicloDetectadoError,
  DefinicionInvalidaError,
  DefinicionNoEncontradaError,
  OperacionDesconocidaError,
  VersionNoDisponibleError,
} from '../domain/errors';

export type DefinicionInput = Omit<DefinicionVersion, 'version'>;

export class CapabilityRegistry {
  constructor(private readonly store: EventStore) {}

  async cargar(ctx: RequestContext, capabilityId: string): Promise<CapDefState> {
    const events = await this.store.readStream(ctx, capdefStreamId(capabilityId));
    return reconstruirCapDef(capabilityId, ctx.organizationId, events);
  }

  private validarComposicion(def: DefinicionInput): void {
    if (!def.nombre || !def.proposito?.trim()) {
      throw new DefinicionInvalidaError('Una capacidad exige nombre y propósito humano');
    }
    if (def.pasos.length === 0) {
      throw new DefinicionInvalidaError('Una capacidad debe componer al menos una operación');
    }
    const ids = new Set(def.pasos.map((p) => p.stepId));
    for (const paso of def.pasos) {
      if (!OPERACIONES_COMPONIBLES.includes(paso.operacion)) {
        throw new OperacionDesconocidaError(`Operación desconocida: ${paso.operacion}`);
      }
      for (const dep of paso.dependeDe) {
        if (!ids.has(dep)) throw new DefinicionInvalidaError(`El paso '${paso.stepId}' depende de uno inexistente: ${dep}`);
      }
      if (paso.usaProductoDe && !ids.has(paso.usaProductoDe)) {
        throw new DefinicionInvalidaError(`El paso '${paso.stepId}' usa el producto de uno inexistente`);
      }
    }
    this.detectarCicloDePasos(def);
  }

  private detectarCicloDePasos(def: DefinicionInput): void {
    const grafo = new Map(def.pasos.map((p) => [p.stepId, p.dependeDe]));
    const estado = new Map<string, 'visitando' | 'visitado'>();
    const dfs = (id: string): void => {
      if (estado.get(id) === 'visitado') return;
      if (estado.get(id) === 'visitando') throw new CicloDetectadoError(`Ciclo entre pasos en '${id}'`);
      estado.set(id, 'visitando');
      for (const dep of grafo.get(id) ?? []) dfs(dep);
      estado.set(id, 'visitado');
    };
    for (const id of grafo.keys()) dfs(id);
  }

  /** Detecta ciclos de composición entre capacidades (debe ser vacío en este bloque). */
  private async detectarCicloDeCapacidades(
    ctx: RequestContext,
    capabilityId: string,
    def: DefinicionInput,
    visitados: Set<string> = new Set(),
  ): Promise<void> {
    for (const ref of def.componeCapacidades) {
      if (ref === capabilityId) {
        throw new CicloDetectadoError(`La capacidad '${capabilityId}' se compondría de sí misma`);
      }
      if (visitados.has(ref)) throw new CicloDetectadoError(`Ciclo de capacidades vía '${ref}'`);
      visitados.add(ref);
      const refState = await this.cargar(ctx, ref);
      const v = refState.vigente ?? Math.max(0, ...Object.keys(refState.versiones).map(Number));
      const refDef = refState.versiones[v];
      if (refDef) {
        if (refDef.componeCapacidades.includes(capabilityId)) {
          throw new CicloDetectadoError(`Ciclo de capacidades entre '${capabilityId}' y '${ref}'`);
        }
        await this.detectarCicloDeCapacidades(ctx, capabilityId, refDef, visitados);
      }
    }
  }

  /** Registra una nueva versión de la definición (append-only). */
  async registrarVersion(ctx: RequestContext, capabilityId: string, input: DefinicionInput): Promise<{ version: number; result: AppendResult }> {
    this.validarComposicion(input);
    await this.detectarCicloDeCapacidades(ctx, capabilityId, input);
    const estado = await this.cargar(ctx, capabilityId);
    const version = Math.max(0, ...Object.keys(estado.versiones).map(Number)) + 1;
    const definicion: DefinicionVersion = { ...input, version };
    const ev: EventInput = {
      type: EVENTOS_CAPDEF.registrada,
      payload: { definicion },
      attribution: input.atribucion,
      occurredAt: input.vigencia.desde,
    };
    const result = await this.store.append(ctx, capdefStreamId(capabilityId), estado.version, [ev]);
    return { version, result };
  }

  async publicar(ctx: RequestContext, capabilityId: string, version: number): Promise<AppendResult> {
    const estado = await this.cargar(ctx, capabilityId);
    if (!estado.versiones[version]) throw new VersionNoDisponibleError(`No existe la versión ${version} de '${capabilityId}'`);
    const def = estado.versiones[version]!;
    return this.store.append(ctx, capdefStreamId(capabilityId), estado.version, [
      { type: EVENTOS_CAPDEF.publicada, payload: { version }, attribution: def.atribucion, occurredAt: def.vigencia.desde },
    ]);
  }

  async retirar(ctx: RequestContext, capabilityId: string, version: number): Promise<AppendResult> {
    const estado = await this.cargar(ctx, capabilityId);
    if (!estado.versiones[version]) throw new VersionNoDisponibleError(`No existe la versión ${version}`);
    const def = estado.versiones[version]!;
    return this.store.append(ctx, capdefStreamId(capabilityId), estado.version, [
      { type: EVENTOS_CAPDEF.retirada, payload: { version }, attribution: def.atribucion, occurredAt: def.vigencia.desde },
    ]);
  }

  /** Resuelve una versión concreta o la vigente. Excluye versiones retiradas. */
  async resolver(ctx: RequestContext, capabilityId: string, version?: number): Promise<DefinicionVersion> {
    const estado = await this.cargar(ctx, capabilityId);
    if (!estado.existe) throw new DefinicionNoEncontradaError(`La capacidad '${capabilityId}' no existe`);
    const v = version ?? estado.vigente;
    if (v === null || v === undefined) throw new VersionNoDisponibleError(`'${capabilityId}' no tiene versión vigente`);
    if (estado.retiradas.includes(v)) throw new VersionNoDisponibleError(`La versión ${v} está retirada`);
    const def = estado.versiones[v];
    if (!def) throw new VersionNoDisponibleError(`No existe la versión ${v}`);
    return def;
  }
}
