/**
 * apps/api · SAFE ACTION PLANE (V2-A) · BUDGET GUARD determinista.
 *
 * Núcleo constitucional: NINGUNA acción pagada puede hacer que el gasto comprometido supere
 * `authorizedBudgetMinor`. Es una cadena de puertas PURAS e independientes; ningún LLM/Director/prompt
 * puede saltarla. El techo se compara en ENTEROS (minor units) contra el mandato PERSISTIDO. Elevar el
 * techo sólo lo hace un humano vía reautorización (fuera de esta capa). El master switch REAL gobierna si
 * algo se ejecuta de verdad; en V2-A es false ⇒ modo DRY_RUN siempre.
 */

import { recomputarEstado, type Mandato } from './mandato';
import { esAccionFinancieraProhibida, type ClaseAccion } from './policy-engine';

export interface AccionPropuesta {
  readonly organizationId: string;
  readonly mandatoId: string;
  readonly idempotencyKey: string;
  readonly actionType: string;
  readonly assetId: string; // id canónico del activo Meta afectado
  readonly costMinor: number; // costo comprometido (minor units). Orgánicas = 0.
  readonly currency: string;
  readonly propuestaPor: string; // actor (Director/SOEC): NUNCA autoriza dinero, sólo propone
}

export interface ContextoAccion {
  readonly ahora: string; // ISO
  readonly autonomousReal: boolean; // master switch REAL (V2-A: false)
  readonly globalKillSwitch: boolean;
}

export interface Gate {
  readonly nombre: string;
  readonly paso: boolean;
  readonly detalle: string;
}

export interface Veredicto {
  readonly permitido: boolean; // pasó TODAS las puertas
  readonly ejecutableReal: boolean; // permitido && master switch ON
  readonly modo: 'DRY_RUN' | 'REAL';
  readonly gates: readonly Gate[];
  readonly bloqueos: readonly string[]; // nombres de puertas que fallaron
}

/**
 * Evalúa una acción propuesta contra el mandato. PURA: no muta nada, no llama a nadie. `yaRegistrada` viene
 * del Action Ledger (idempotencia). Devuelve el veredicto con TODAS las puertas para auditoría.
 */
export function evaluarBudgetGuard(m: Mandato, accion: AccionPropuesta, clase: ClaseAccion, ctx: ContextoAccion, yaRegistrada: boolean): Veredicto {
  const estado = recomputarEstado(m, ctx.ahora);
  const costoEntero = Number.isInteger(accion.costMinor) && accion.costMinor >= 0;
  const costoOrganicoCero = clase.pagada || accion.costMinor === 0; // no-pagada debe costar 0

  const gates: Gate[] = [
    { nombre: 'ACCION_WHITELISTED', paso: clase.permitida && !esAccionFinancieraProhibida(accion.actionType), detalle: `acción ${accion.actionType} debe estar en el catálogo y no ser financiera prohibida` },
    { nombre: 'TENANT', paso: accion.organizationId === m.organizationId, detalle: 'la acción debe pertenecer al tenant del mandato' },
    { nombre: 'MANDATO_ID', paso: accion.mandatoId === m.id, detalle: 'la acción debe referir al mandato correcto' },
    { nombre: 'MANDATO_ACTIVE', paso: estado === 'ACTIVE', detalle: `mandato debe estar ACTIVE (está ${estado})` },
    { nombre: 'KILL_SWITCH_OFF', paso: !m.killSwitch && !ctx.globalKillSwitch, detalle: 'ningún kill switch (mandato/global) puede estar activo' },
    { nombre: 'PERIODO_VIGENTE', paso: Date.parse(ctx.ahora) >= Date.parse(m.periodStart) && Date.parse(ctx.ahora) < Date.parse(m.periodEnd), detalle: 'la acción debe caer dentro del período autorizado' },
    { nombre: 'MONEDA', paso: accion.currency === m.currency, detalle: `moneda debe ser ${m.currency}` },
    { nombre: 'ACTIVO_AUTORIZADO', paso: m.allowedMetaAssets.includes(accion.assetId), detalle: 'el activo debe estar autorizado en el mandato' },
    { nombre: 'ACCION_AUTORIZADA', paso: m.allowedActionTypes.includes(accion.actionType), detalle: 'el tipo de acción debe estar autorizado en el mandato' },
    { nombre: 'COSTO_ENTERO_NO_NEGATIVO', paso: costoEntero, detalle: 'el costo debe ser entero ≥ 0 (minor units)' },
    { nombre: 'COSTO_ORGANICO_CERO', paso: costoOrganicoCero, detalle: 'una acción no pagada no puede tener costo' },
    // TECHO DE PRESUPUESTO — el invariante constitucional. Sólo aplica a acciones pagadas.
    { nombre: 'TECHO_PRESUPUESTO', paso: !clase.pagada || (costoEntero && m.spentMinor + accion.costMinor <= m.authorizedBudgetMinor), detalle: 'gasto comprometido + costo no puede superar el presupuesto autorizado' },
    { nombre: 'IDEMPOTENCIA', paso: !yaRegistrada, detalle: 'la acción no puede haberse registrado antes (misma idempotencyKey)' },
  ];

  const bloqueos = gates.filter((g) => !g.paso).map((g) => g.nombre);
  const permitido = bloqueos.length === 0;
  const ejecutableReal = permitido && ctx.autonomousReal === true;
  return { permitido, ejecutableReal, modo: ejecutableReal ? 'REAL' : 'DRY_RUN', gates, bloqueos };
}
