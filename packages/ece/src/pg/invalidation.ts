/**
 * Procesamiento del ECE en el worker: proyecta los eventos del ECE e invalida
 * (marca "requiere reconstrucción") los ECE cuyas entradas MED/MDM cambiaron.
 * No decide ni ejecuta acciones reservadas a la persona (#12): solo marca estado
 * y conserva trazabilidad causal (la invalidación enlaza al evento que la provocó).
 */
import { ActorId, type Attribution, OrganizationId, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { parseStream } from '@soec/models';
import type { EceBuildService } from '../app/build-service';
import { type EceProjectionStore, aplicarEventoAProyeccionEce, parseEceStream } from '../projections/projection';

const ATRIBUCION_SISTEMA: Attribution = {
  source: 'ECE:worker',
  purpose: 'invalidación por cambio de entradas MED/MDM',
  assumptions: [],
  claimType: 'observational',
  regime: 'formal',
  uncertainty: 'none',
};

/** Contexto de sistema del worker: alcance mínimo para proyectar e invalidar. */
export function contextoSistema(organizationId: string): RequestContext {
  const org = OrganizationId(organizationId);
  return {
    organizationId: org,
    actor: ActorId('ece-worker'),
    scope: { organizationId: org, permissions: ['events:append', 'events:read'] },
    correlationId: `ece-worker-${organizationId}`,
  };
}

export interface EceWorkerDeps {
  readonly eceProjStore: EceProjectionStore;
  readonly build: EceBuildService;
}

/**
 * Procesa un evento para el ECE:
 * - si es un evento del ECE → actualiza su proyección (idempotente);
 * - si es un evento de MED/MDM → invalida los ECE cuyo corte quedó atrás.
 * Devuelve cuántas invalidaciones se emitieron.
 */
export async function procesarEventoParaEce(event: RecordedEvent, deps: EceWorkerDeps): Promise<number> {
  if (parseEceStream(event.streamId)) {
    await aplicarEventoAProyeccionEce(deps.eceProjStore, event);
    return 0;
  }
  const ref = parseStream(event.streamId);
  if (!ref) return 0;
  const afectados = await deps.eceProjStore.afectadosPorModelo(
    event.organizationId,
    ref.modelType,
    ref.instanceId,
    event.sequence,
  );
  let n = 0;
  for (const a of afectados) {
    const ctx = contextoSistema(event.organizationId);
    await deps.build.invalidar(ctx, {
      eceId: a.eceId,
      motivo: `cambio en ${ref.modelType}:${ref.instanceId} (secuencia ${event.sequence})`,
      causationId: event.eventId,
      attribution: ATRIBUCION_SISTEMA,
      occurredAt: event.recordedAt,
    });
    n += 1;
  }
  return n;
}
