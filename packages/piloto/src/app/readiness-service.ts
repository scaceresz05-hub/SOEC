/**
 * Servicio de readiness: evalúa la preparación de una organización por entorno y deriva
 * el checklist de activación (determinista). No modifica agregados de otros módulos.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import type { Entorno } from '../domain/entorno';
import { orgStreamId, reconstruirOrg, type OrgState } from '../domain/organizacion';
import { type EvaluacionReadiness, evaluarReadiness } from '../domain/readiness';
import type { ItemChecklist } from '../domain/expediente';

const PUNTOS_CHECKLIST = ['organización verificada', 'responsables', 'identidad', 'objetivo', 'política', 'presupuesto', 'canal', 'credencial', 'contenido', 'calendario', 'medición', 'pausa', 'rollback', 'éxito', 'suspensión', 'aprobación final'];

export class ReadinessService {
  constructor(private readonly store: EventStore) {}

  private cargarOrg(ctx: RequestContext, orgId: string): Promise<OrgState> {
    return this.store.readStream(ctx, orgStreamId(orgId)).then((e) => reconstruirOrg(orgId, String(ctx.organizationId), e));
  }

  async evaluar(ctx: RequestContext, orgId: string, entorno: Entorno, ensayoAprobado: boolean): Promise<EvaluacionReadiness> {
    return evaluarReadiness(await this.cargarOrg(ctx, orgId), entorno, ensayoAprobado);
  }

  /** Deriva el checklist de activación de la evaluación de readiness (determinista). */
  checklistDesde(ev: EvaluacionReadiness): ItemChecklist[] {
    const porCategoria = new Map<string, boolean>();
    for (const c of ev.chequeos) {
      const ok = c.estado === 'aprobado' || c.estado === 'aprobado_con_advertencia' || c.estado === 'no_aplicable';
      porCategoria.set(c.categoria, (porCategoria.get(c.categoria) ?? true) && ok && !c.bloqueo);
    }
    const bloqueoGlobal = ev.chequeos.some((c) => c.bloqueo || c.estado === 'bloqueado');
    return PUNTOS_CHECKLIST.map((punto) => {
      // 'aprobación final' siempre pendiente en F2-PILOT-01 (bloqueo de activación real).
      if (punto === 'aprobación final') return { punto, estado: 'bloqueado' as const, evidencia: 'requiere autorización estratégica explícita', bloqueo: true };
      const okReadiness = !bloqueoGlobal && ev.resultado !== 'bloqueado' && ev.resultado !== 'incompleto';
      return { punto, estado: okReadiness ? ('aprobado' as const) : ('pendiente' as const), evidencia: `readiness ${ev.resultado} (${ev.entorno})`, bloqueo: false };
    });
  }
}
