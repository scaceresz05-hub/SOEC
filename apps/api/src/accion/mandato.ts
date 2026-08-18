/**
 * apps/api · SAFE ACTION PLANE (V2-A) · CAMPAIGN MANDATE.
 *
 * REGLA CONSTITUCIONAL — HUMAN_FINANCIAL_SOVEREIGNTY = ABSOLUTE:
 * un Mandato es un TOPE DURO de gasto que SÓLO un humano puede crear/autorizar/ampliar. SOEC opera DENTRO
 * y NUNCA puede: elevar `authorizedBudget`, extender el período, cambiar la moneda, renovar al agotarse,
 * crear un mandato para sí mismo, ni interpretar silencio/histórico como autorización financiera.
 * Toda ampliación exige una NUEVA autorización humana explícita. Esto NO depende de LLM/Director/prompt:
 * el dinero se representa en ENTEROS (minor units) y los invariantes viven en código determinista.
 */

export type EstadoMandato = 'DRAFT' | 'AUTHORIZED' | 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED' | 'REVOKED';

/** Actores que JAMÁS pueden autorizar/ampliar presupuesto (SOEC y su maquinaria). Enforcement determinista. */
const ACTORES_SISTEMA = ['soec', 'director', 'meta-scheduler', 'meta-callback', 'scheduler', 'sistema', 'system', 'autonomo', 'action-plane'];
export function esActorSistema(actor: string): boolean {
  const a = actor.trim().toLowerCase();
  return a === '' || ACTORES_SISTEMA.some((s) => a === s || a.startsWith(`${s}:`) || a.startsWith(`${s}-`));
}

export interface Mandato {
  readonly id: string;
  readonly organizationId: string;
  readonly objective: string;
  readonly currency: string; // ISO 4217 (p.ej. CLP)
  readonly authorizedBudgetMinor: number; // TOPE DURO, entero, minor units. Inmutable salvo reautorización humana.
  readonly spentMinor: number; // acumulado comprometido; nunca supera authorizedBudgetMinor.
  readonly periodStart: string; // ISO
  readonly periodEnd: string; // ISO
  readonly allowedMetaAssets: readonly string[]; // ids canónicos permitidos
  readonly allowedActionTypes: readonly string[]; // whitelist de acciones
  readonly status: EstadoMandato;
  readonly killSwitch: boolean; // corte de emergencia por-mandato
  readonly authorizedBy: string; // actor HUMANO que autorizó (nunca sistema)
  readonly authorizedAt: string | null;
  readonly createdAt: string;
  readonly version: number; // se incrementa en cada reautorización humana (trazabilidad)
}

export interface EntradaMandato {
  readonly organizationId: string;
  readonly objective: string;
  readonly currency: string;
  readonly authorizedBudgetMinor: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly allowedMetaAssets: readonly string[];
  readonly allowedActionTypes: readonly string[];
}

export class AutorizacionInvalidaError extends Error {}

function validarEntrada(e: EntradaMandato): void {
  if (!e.organizationId.trim()) throw new AutorizacionInvalidaError('organización requerida');
  if (!Number.isInteger(e.authorizedBudgetMinor) || e.authorizedBudgetMinor <= 0) throw new AutorizacionInvalidaError('presupuesto debe ser entero positivo (minor units)');
  if (!/^[A-Z]{3}$/.test(e.currency)) throw new AutorizacionInvalidaError('moneda ISO-4217 inválida');
  if (Date.parse(e.periodEnd) <= Date.parse(e.periodStart)) throw new AutorizacionInvalidaError('período inválido (fin ≤ inicio)');
  if (e.allowedActionTypes.length === 0) throw new AutorizacionInvalidaError('debe autorizar al menos un tipo de acción');
}

/**
 * Crea un mandato AUTORIZADO por un HUMANO. Rechaza si el actor es sistema (SOEC no puede autorizarse a sí mismo).
 * `id`/`ahora` se inyectan (deterministas/testeable). El presupuesto es un tope duro fijado por adelantado.
 */
export function crearMandatoAutorizado(entrada: EntradaMandato, authorizedBy: string, id: string, ahora: string): Mandato {
  validarEntrada(entrada);
  if (esActorSistema(authorizedBy)) throw new AutorizacionInvalidaError('sólo un humano puede autorizar presupuesto (SOEC no puede autorizarse)');
  const activo = Date.parse(entrada.periodStart) <= Date.parse(ahora) && Date.parse(ahora) < Date.parse(entrada.periodEnd);
  return {
    id,
    organizationId: entrada.organizationId,
    objective: entrada.objective,
    currency: entrada.currency,
    authorizedBudgetMinor: entrada.authorizedBudgetMinor,
    spentMinor: 0,
    periodStart: entrada.periodStart,
    periodEnd: entrada.periodEnd,
    allowedMetaAssets: [...entrada.allowedMetaAssets],
    allowedActionTypes: [...entrada.allowedActionTypes],
    status: activo ? 'ACTIVE' : 'AUTHORIZED',
    killSwitch: false,
    authorizedBy,
    authorizedAt: ahora,
    createdAt: ahora,
    version: 1,
  };
}

/**
 * REAUTORIZACIÓN humana (única vía de ampliar presupuesto/período). Rechaza actor sistema y reducciones por
 * debajo de lo ya gastado. Incrementa la versión. NUNCA la llama la maquinaria autónoma (endpoint humano).
 */
export function reautorizar(m: Mandato, nuevoBudgetMinor: number, nuevoPeriodEnd: string, authorizedBy: string, ahora: string): Mandato {
  if (esActorSistema(authorizedBy)) throw new AutorizacionInvalidaError('sólo un humano puede reautorizar presupuesto');
  if (!Number.isInteger(nuevoBudgetMinor) || nuevoBudgetMinor < m.spentMinor) throw new AutorizacionInvalidaError('el nuevo presupuesto no puede ser menor a lo ya gastado');
  if (Date.parse(nuevoPeriodEnd) <= Date.parse(m.periodStart)) throw new AutorizacionInvalidaError('período inválido');
  return { ...m, authorizedBudgetMinor: nuevoBudgetMinor, periodEnd: nuevoPeriodEnd, authorizedBy, authorizedAt: ahora, version: m.version + 1, status: recomputarEstado({ ...m, authorizedBudgetMinor: nuevoBudgetMinor, periodEnd: nuevoPeriodEnd }, ahora) };
}

/** Estado derivado por tiempo/gasto/kill switch (determinista). No cambia budget/currency/period. */
export function recomputarEstado(m: Pick<Mandato, 'status' | 'authorizedBudgetMinor' | 'spentMinor' | 'periodStart' | 'periodEnd' | 'killSwitch'>, ahora: string): EstadoMandato {
  if (m.status === 'REVOKED') return 'REVOKED';
  if (m.killSwitch || m.status === 'PAUSED') return 'PAUSED';
  const t = Date.parse(ahora);
  if (t >= Date.parse(m.periodEnd)) return 'EXPIRED';
  if (m.spentMinor >= m.authorizedBudgetMinor) return 'EXHAUSTED';
  if (t < Date.parse(m.periodStart)) return 'AUTHORIZED';
  return 'ACTIVE';
}

/** Aplica pausa / reanudación / revocación / kill switch (acciones de gobierno, humanas). */
export function pausar(m: Mandato): Mandato {
  return { ...m, status: 'PAUSED' };
}
export function reanudar(m: Mandato, ahora: string): Mandato {
  if (m.status !== 'PAUSED') return m;
  return { ...m, status: recomputarEstado({ ...m, status: 'ACTIVE' }, ahora) };
}
export function revocar(m: Mandato): Mandato {
  return { ...m, status: 'REVOKED' };
}
export function fijarKillSwitch(m: Mandato, activo: boolean, ahora: string): Mandato {
  const con = { ...m, killSwitch: activo };
  return { ...con, status: recomputarEstado(con, ahora) };
}

/** Presupuesto restante (nunca negativo). */
export function restanteMinor(m: Mandato): number {
  return Math.max(0, m.authorizedBudgetMinor - m.spentMinor);
}
