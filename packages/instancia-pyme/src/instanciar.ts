/**
 * Ensambla la instanciación del primer dominio real sobre el sistema existente:
 * siembra MED+MDM de la pyme, construye su ECE, registra y publica la capacidad
 * «Comprender el estado», y ofrece su ejecución. No accede a tablas ni inventa
 * arquitectura: usa exclusivamente los servicios públicos ya construidos.
 */
import type { Attribution, RequestContext } from '@soec/contracts';
import type { MedService, MdmService } from '@soec/models';
import type { EceBuildService } from '@soec/ece';
import type { CapabilitiesOrchestrator, CapabilityRegistry, CapResultado } from '@soec/capacidades';
import { definicionComprenderEstado } from '@soec/capacidades';
import { IDS, type SeedOpts, sembrarDominio } from './dominio';

export interface InstanciarDeps {
  readonly med: MedService;
  readonly mdm: MdmService;
  readonly eceBuild: EceBuildService;
  readonly registry: CapabilityRegistry;
}

/** Siembra el dominio, construye el ECE y registra+publica la capacidad real. */
export async function instanciarPyme(ctx: RequestContext, deps: InstanciarDeps, o: SeedOpts): Promise<typeof IDS> {
  const c = { attribution: o.attribution, occurredAt: o.occurredAt };
  await sembrarDominio(ctx, { med: deps.med, mdm: deps.mdm }, o);
  await deps.eceBuild.construir(ctx, { eceId: IDS.ece, medInstanceId: IDS.med, mdmInstanceId: IDS.mdm, ...c });
  await deps.registry.registrarVersion(ctx, IDS.capacidad, definicionComprenderEstado(o.attribution));
  await deps.registry.publicar(ctx, IDS.capacidad, 1);
  return IDS;
}

/** Ejecuta la capacidad «Comprender el estado» sobre el ECE de la pyme. */
export function ejecutarComprenderEstado(
  ctx: RequestContext,
  orchestrator: CapabilitiesOrchestrator,
  executionId: string,
  o: { attribution: Attribution; occurredAt: string; idempotencyKey?: string },
): Promise<CapResultado> {
  return orchestrator.ejecutar(ctx, executionId, {
    capabilityId: IDS.capacidad,
    eceId: IDS.ece,
    // El paso esclarecer apunta a la contradicción intra-MED detectada.
    objetivos: { e1: IDS.contradiccion },
    attribution: o.attribution,
    occurredAt: o.occurredAt,
    ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
  });
}
