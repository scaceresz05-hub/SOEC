/**
 * apps/api · SAFE ACTION PLANE (V2-A) · ORQUESTACIÓN.
 *
 * Camino ÚNICO de toda acción de marketing: PROPOSAL → POLICY ENGINE → BUDGET GUARD → ACTION LEDGER →
 * (compromiso de gasto sólo si REAL). Nunca LLM→Meta directo. En V2-A el master switch REAL es false ⇒
 * todo es SIMULADA (dry-run), no se compromete gasto, y REAL_MONEY_SPENT = 0. El compromiso de gasto sólo
 * ocurre en modo REAL y JAMÁS supera el techo (garantizado por el Budget Guard, re-checado al comprometer).
 */

import { recomputarEstado, type Mandato } from './mandato';
import { clasificarAccion } from './policy-engine';
import { evaluarBudgetGuard, type AccionPropuesta, type ContextoAccion, type Veredicto } from './budget-guard';
import { asientoDesdeVeredicto, type ActionLedgerRepo, type AsientoAccion } from './ledger';

export interface DepsActionPlane {
  readonly ledger: ActionLedgerRepo;
  readonly ahora: () => string;
  readonly autonomousReal: boolean; // V2-A: false
  readonly globalKillSwitch: boolean;
  readonly nuevoId: () => string;
}

export interface ResultadoAccion {
  readonly veredicto: Veredicto;
  readonly asiento: AsientoAccion;
  readonly mandatoActualizado: Mandato; // con gasto comprometido si se ejecutó REAL; si no, sólo estado recomputado
  readonly yaExistia: boolean; // idempotencia: la acción ya estaba en el ledger
  readonly gastoComprometidoMinor: number; // 0 salvo ejecución REAL de acción pagada
}

/**
 * Procesa una acción propuesta. Idempotente (el ledger es la barrera atómica). Comité de gasto sólo si el
 * veredicto es REAL (master switch ON) y la acción es pagada; incluso ahí, el techo se re-verifica.
 */
export async function procesarAccion(deps: DepsActionPlane, mandato: Mandato, accion: AccionPropuesta): Promise<ResultadoAccion> {
  const ahora = deps.ahora();
  const ctx: ContextoAccion = { ahora, autonomousReal: deps.autonomousReal, globalKillSwitch: deps.globalKillSwitch };
  const clase = clasificarAccion(accion.actionType);

  // Idempotencia: si ya existe, devolver el asiento previo sin re-evaluar ni re-cobrar.
  const previa = await deps.ledger.obtener(accion.organizationId, accion.idempotencyKey);
  if (previa !== null) {
    return {
      veredicto: { permitido: previa.estado !== 'RECHAZADA', ejecutableReal: previa.estado === 'EJECUTADA', modo: previa.modo, gates: [], bloqueos: previa.bloqueos },
      asiento: previa,
      mandatoActualizado: { ...mandato, status: recomputarEstado(mandato, ahora) },
      yaExistia: true,
      gastoComprometidoMinor: 0,
    };
  }

  const veredicto = evaluarBudgetGuard(mandato, accion, clase, ctx, false);
  const asiento = asientoDesdeVeredicto(deps.nuevoId(), accion, veredicto, ahora);

  const inserto = await deps.ledger.registrarSiNuevo(asiento);
  if (!inserto) {
    // Carrera perdida: otra ejecución concurrente ya registró esta idempotencyKey.
    const existente = (await deps.ledger.obtener(accion.organizationId, accion.idempotencyKey))!;
    return { veredicto, asiento: existente, mandatoActualizado: { ...mandato, status: recomputarEstado(mandato, ahora) }, yaExistia: true, gastoComprometidoMinor: 0 };
  }

  // Compromiso de gasto: SÓLO en modo REAL y acción pagada. Re-verifica el techo (defensa en profundidad).
  let mandatoActualizado = { ...mandato, status: recomputarEstado(mandato, ahora) };
  let gastoComprometidoMinor = 0;
  if (asiento.estado === 'EJECUTADA' && clase.pagada) {
    const nuevoGasto = mandato.spentMinor + accion.costMinor;
    if (nuevoGasto > mandato.authorizedBudgetMinor) {
      // Nunca debería ocurrir (el guard ya lo bloqueó); defensa dura: no comprometer.
      gastoComprometidoMinor = 0;
    } else {
      gastoComprometidoMinor = accion.costMinor;
      const conGasto = { ...mandato, spentMinor: nuevoGasto };
      mandatoActualizado = { ...conGasto, status: recomputarEstado(conGasto, ahora) };
    }
  }

  return { veredicto, asiento, mandatoActualizado, yaExistia: false, gastoComprometidoMinor };
}
