/**
 * Servicio de políticas: registrar versiones, publicar la vigente, suspender,
 * reanudar y revocar. Append-only y versionado. La persona (autoridad estratégica)
 * define y controla las políticas; SOEC solo ejecuta lo que ellas autorizan.
 */
import type { AppendResult, Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type ContenidoPolitica,
  EVENTOS_POL,
  type PolicyState,
  type VersionPolitica,
  polStreamId,
  reconstruirPolicy,
} from '../domain/policy';
import { PoliticaNoEncontradaError, SolicitudOperativaInvalidaError } from '../domain/errors';

export class PolicyService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, policyId: string): Promise<PolicyState> {
    return this.store.readStream(ctx, polStreamId(policyId)).then((e) => reconstruirPolicy(policyId, ctx.organizationId, e));
  }

  async registrarVersion(
    ctx: RequestContext,
    policyId: string,
    contenido: ContenidoPolitica,
    attribution: Attribution,
    occurredAt: string,
  ): Promise<{ version: number; result: AppendResult }> {
    if (!contenido.empresa || !contenido.objetivo) {
      throw new SolicitudOperativaInvalidaError('Una política exige empresa y objetivo');
    }
    if (contenido.presupuestoTotal < 0) throw new SolicitudOperativaInvalidaError('El presupuesto no puede ser negativo');
    const estado = await this.cargar(ctx, policyId);
    const version = Math.max(0, ...Object.keys(estado.versiones).map(Number)) + 1;
    const v: VersionPolitica = { ...contenido, version, vigenciaDesde: occurredAt, atribucion: attribution };
    const result = await this.store.append(ctx, polStreamId(policyId), estado.version, [
      { type: EVENTOS_POL.registrada, payload: { version: v }, attribution, occurredAt },
    ]);
    return { version, result };
  }

  private async transicion(ctx: RequestContext, policyId: string, type: string, attribution: Attribution, occurredAt: string, payload: unknown = {}): Promise<AppendResult> {
    const estado = await this.cargar(ctx, policyId);
    if (!estado.existe) throw new PoliticaNoEncontradaError(`La política '${policyId}' no existe`);
    return this.store.append(ctx, polStreamId(policyId), estado.version, [{ type, payload, attribution, occurredAt }]);
  }

  publicar(ctx: RequestContext, policyId: string, version: number, attribution: Attribution, occurredAt: string): Promise<AppendResult> {
    return this.transicion(ctx, policyId, EVENTOS_POL.publicada, attribution, occurredAt, { version });
  }
  suspender(ctx: RequestContext, policyId: string, motivo: string, attribution: Attribution, occurredAt: string): Promise<AppendResult> {
    return this.transicion(ctx, policyId, EVENTOS_POL.suspendida, attribution, occurredAt, { motivo });
  }
  reanudar(ctx: RequestContext, policyId: string, attribution: Attribution, occurredAt: string): Promise<AppendResult> {
    return this.transicion(ctx, policyId, EVENTOS_POL.reanudada, attribution, occurredAt);
  }
  revocar(ctx: RequestContext, policyId: string, motivo: string, attribution: Attribution, occurredAt: string): Promise<AppendResult> {
    return this.transicion(ctx, policyId, EVENTOS_POL.revocada, attribution, occurredAt, { motivo });
  }
}
