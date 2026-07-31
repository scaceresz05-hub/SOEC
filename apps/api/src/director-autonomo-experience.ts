/**
 * Experiencia «Director Autónomo» — CABLEADO del núcleo Director de Marketing Autónomo V1
 * (paquetes A–J) al runtime real. No introduce dominio nuevo: compone los servicios existentes
 * sobre el `EventStore` real (PgEventStore en producción) y expone:
 *   - estado(org): la vista del ciclo (Bloque I) reconstruida READ-ONLY desde el store, con la
 *     naturaleza de cada dato (REAL/SIMULADO/ESTIMADO/DESCONOCIDO).
 *   - ejecutarCiclo(org): corre el ciclo gobernado (decisión→campaña→contenido→autorización→
 *     ejecución simulada→medición→experimento→aprendizaje→siguiente decisión) y lo PERSISTE.
 *     Idempotente: reutiliza streams existentes.
 *   - pausar/reanudar(org): modo seguro real vía `@soec/autonomia` (la PAUSA prevalece; reanudar
 *     exige actor humano). Usa el reloj inyectado para el tiempo de ocurrencia.
 * La ejecución es SIMULADA; no hay efectos externos reales. Todo queda acotado por organización.
 */
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import { AutonomiaService } from '@soec/autonomia';
import { ejecutarPiloto, reconstruirVistaDirector, type TrazaPiloto, type VistaCicloDirector } from '@soec/piloto-director-v1';

const ATRIBUCION: Attribution = {
  source: 'director-autonomo',
  purpose: 'gobierno del ciclo de marketing autónomo por el Director',
  assumptions: ['ejecución simulada; sin efectos externos reales'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

export class DirectorAutonomoExperience {
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock,
  ) {}

  private ctx(org: string): RequestContext {
    const organizationId = OrganizationId(org);
    return {
      organizationId,
      actor: ActorId('director'),
      scope: { organizationId, permissions: ['events:append', 'events:read'] },
      correlationId: `da-${org}`,
    };
  }

  /** Vista del ciclo reconstruida sin escribir eventos. Si el ciclo no corrió, es "vacía" honesta. */
  async estado(org: string): Promise<VistaCicloDirector> {
    const { vista } = await reconstruirVistaDirector(this.store, org);
    return vista;
  }

  /** Corre el ciclo gobernado y lo persiste en el store real. Idempotente. Devuelve traza + vista. */
  async ejecutarCiclo(org: string): Promise<TrazaPiloto> {
    return ejecutarPiloto(this.store, 'SUCCESS', org);
  }

  /** Activa el modo seguro (PAUSA) para la organización y devuelve la vista actualizada. */
  async pausar(org: string, motivo: string): Promise<VistaCicloDirector> {
    await new AutonomiaService(this.store).pausar(this.ctx(org), motivo || 'pausa solicitada por el Director', ATRIBUCION, this.clock.now());
    return this.estado(org);
  }

  /** Reanuda desde el modo seguro. Exige un actor humano (lo valida el dominio). */
  async reanudar(org: string, actorHumano: string, motivo: string): Promise<VistaCicloDirector> {
    await new AutonomiaService(this.store).reanudar(this.ctx(org), actorHumano, motivo || 'reanudación autorizada por el Director', ATRIBUCION, this.clock.now());
    return this.estado(org);
  }
}
