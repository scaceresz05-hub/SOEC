/**
 * @soec/cia · app · RECONCILIADOR (recuperación transversal). Recorre autorizaciones, planes y reservas;
 * detecta la matriz de inconsistencias del CIA y repara idempotentemente o clasifica honestamente. No borra
 * historia. Determinista. Dos reconciliadores concurrentes convergen.
 * Clasificaciones: REPARADA · NO_REQUIERE_ACCION · NO_REPARABLE · REQUIERE_INTERVENCION.
 */
import type { Attribution, RequestContext } from '@soec/contracts';
import { esPlanTerminal } from '../dominio/plan';
import { estaBloqueada } from '../dominio/kill-switch';
import { AutorizacionesService } from './autorizaciones-service';
import { PlanificadorService } from './planificador-service';
import { PresupuestoService } from './presupuesto-service';
import { KillSwitchService } from './kill-switch-service';

export type ClaseHallazgoCIA =
  | 'PLAN_SIN_AUTORIZACION_VIGENTE' | 'RESERVA_SIN_ACCION' | 'CONSUMO_SIN_RESULTADO' | 'EJECUCION_SIN_EVIDENCIA'
  | 'REVOCACION_CON_PLANES_ACTIVOS' | 'KILL_CON_TRABAJOS_PENDIENTES' | 'READ_MODEL_INCOMPLETO'
  | 'RESULTADO_REAL' | 'EXPLICACION_AUSENTE';

export type Clasificacion = 'REPARADA' | 'NO_REQUIERE_ACCION' | 'NO_REPARABLE' | 'REQUIERE_INTERVENCION';
export interface HallazgoCIA { readonly clase: ClaseHallazgoCIA; readonly clasificacion: Clasificacion; readonly ref: string; readonly detalle: string }

export class ReconciliadorCIAService {
  constructor(
    private readonly autorizaciones: AutorizacionesService,
    private readonly planificador: PlanificadorService,
    private readonly presupuesto: PresupuestoService,
    private readonly kill: KillSwitchService,
  ) {}

  async reconciliar(ctx: RequestContext, a: Attribution, o: string): Promise<readonly HallazgoCIA[]> {
    const h: HallazgoCIA[] = [];
    const push = (x: HallazgoCIA) => h.push(x);
    const killSt = await this.kill.cargar(ctx);
    const capacidades = await this.autorizaciones.listar(ctx);
    const planIds = await this.planificador.listarPlanes(ctx);

    for (const planId of planIds) {
      const p = await this.planificador.cargar(ctx, planId);
      if (!p.existe) continue;
      const auth = await this.autorizaciones.cargar(ctx, p.capacidadId);

      // Plan no terminal cuya autorización dejó de estar vigente (revocada/pausada/expirada).
      if (!esPlanTerminal(p.estado) && auth.estado !== 'AUTORIZADA')
        push({ clase: 'PLAN_SIN_AUTORIZACION_VIGENTE', clasificacion: 'REQUIERE_INTERVENCION', ref: planId, detalle: `plan ${p.estado} con autorización ${auth.estado}` });

      // Autorización revocada con planes activos.
      if (auth.estado === 'REVOCADA' && !esPlanTerminal(p.estado))
        push({ clase: 'REVOCACION_CON_PLANES_ACTIVOS', clasificacion: 'REQUIERE_INTERVENCION', ref: planId, detalle: 'autorización revocada con plan activo' });

      // Kill-switch con trabajos pendientes.
      if (estaBloqueada(killSt, p.capacidadId) && p.estado === 'PENDIENTE_APROBACION')
        push({ clase: 'KILL_CON_TRABAJOS_PENDIENTES', clasificacion: 'REQUIERE_INTERVENCION', ref: planId, detalle: 'pausa activa con plan pendiente' });

      // Ejecución sin evidencia (corrupción): completado sin evidencia simulada.
      if (p.estado === 'COMPLETADO_SIMULADO' && !p.evidenciaSimulada)
        push({ clase: 'EJECUCION_SIN_EVIDENCIA', clasificacion: 'NO_REPARABLE', ref: planId, detalle: 'completado sin evidencia' });

      // Explicación ausente en una decisión pendiente (sin objetivo declarado).
      if (p.estado === 'PENDIENTE_APROBACION' && !p.objetivo?.trim())
        push({ clase: 'EXPLICACION_AUSENTE', clasificacion: 'REQUIERE_INTERVENCION', ref: planId, detalle: 'decisión pendiente sin objetivo/explicación' });
    }

    for (const capacidadId of capacidades) {
      for (const r of await this.presupuesto.listarReservas(ctx, capacidadId)) {
        const plan = await this.planificador.cargar(ctx, r.reservaId);
        // Reserva RESERVADA cuyo plan ya es terminal ⇒ huérfana ⇒ liberar (reparación segura, idempotente).
        if (r.estado === 'RESERVADA' && (!plan.existe || esPlanTerminal(plan.estado))) {
          await this.presupuesto.liberar(ctx, r.reservaId, a, o);
          push({ clase: 'RESERVA_SIN_ACCION', clasificacion: 'REPARADA', ref: r.reservaId, detalle: 'reserva huérfana → liberada' });
        }
        // Consumo confirmado sin resultado completado.
        if (r.estado === 'CONFIRMADA' && plan.existe && plan.estado !== 'COMPLETADO_SIMULADO')
          push({ clase: 'CONSUMO_SIN_RESULTADO', clasificacion: 'REQUIERE_INTERVENCION', ref: r.reservaId, detalle: `consumo confirmado con plan ${plan.estado}` });
      }
    }

    return h;
  }
}
