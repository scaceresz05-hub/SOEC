/**
 * @soec/autonomia · mandato · PIPELINE DE GATES (guardián único, fail-closed).
 *
 * `evaluarAccion` es LA compuerta previa a cualquier mutación. La usa el modo SOMBRA para decir «qué
 * haría» y la usará —sin cambios— la futura ejecución real, revalidando JUSTO antes del HTTP mutante
 * (TOCTOU). Precedencia: DENY > REQUIRE_APPROVAL > OBSERVE_MORE > EXECUTE. Todo lo dudoso deniega.
 *
 * Orden de comprobación (seguridad primero): aislamiento de tenant → credencial → mandato activo →
 * interruptores → expiración → clasificación de la acción → idempotencia → rollback → presupuesto →
 * velocidad → cooldown → aprobación cruzada → evidencia → nivel/aprobación/reversibilidad.
 */
import { metaDeAccion, type TipoAccion } from './acciones';
import {
  clasificarAccion,
  nivelPermiteEjecucionAutonoma,
  type InterruptoresSeguridad,
  type MandatoAutonomia,
} from './mandato';

export type Decision = 'EXECUTE' | 'REQUIRE_APPROVAL' | 'OBSERVE_MORE' | 'DENY';

export interface Evidencia {
  readonly muestra: number; // sampleSize (p. ej. impresiones)
  readonly ventanaHoras: number; // observationWindow
  readonly confianza?: number; // 0..1
  readonly relevanciaConocida?: boolean;
}

export interface Aprobacion {
  readonly porOrg: string;
  readonly actorHumano: string;
  readonly otorgadaEn: string;
  readonly expiraEn: string;
}

export interface AccionPropuesta {
  readonly actionId: string; // clave de idempotencia
  readonly organizationId: string;
  readonly businessKey: string;
  readonly externalAccountId: string;
  readonly targetId: string;
  readonly tipo: TipoAccion;
  readonly desiredState: string;
  readonly evidencia: Evidencia;
  /** Organización dueña de la credencial que se usaría. Debe coincidir con la del mandato. */
  readonly credentialRefOwnerOrg: string;
  /** Delta financiero de la acción (si aplica), en la moneda de la cuenta. */
  readonly montoCambio?: number;
  readonly rollbackDisponible: boolean;
  readonly aprobacion?: Aprobacion | null;
  /** Versión del mandato contra la que se generó la intención (para detectar cambios). */
  readonly mandateVersionVista: number;
}

export interface ContextoEjecucion {
  /** Mandato ACTUAL (revalidado en el momento de evaluar; no una copia vieja). */
  readonly mandato: MandatoAutonomia;
  readonly interruptores: InterruptoresSeguridad;
  readonly ahora: string; // ISO-8601 UTC
  readonly gastoDiario: number;
  readonly gastoMensual: number;
  readonly gastoDiarioPrevio: number; // línea base para % de aumento
  readonly cambiosUltimaHora: number;
  readonly cambiosHoy: number;
  readonly cambiosCampaniaHoy: number;
  readonly enCooldown: boolean;
  /** actionIds ya ejecutados (idempotencia). */
  readonly accionesYaEjecutadas: readonly string[];
}

export interface ResultadoGate {
  readonly decision: Decision;
  readonly razon: string; // código legible por máquina
  readonly explicacion: string; // lenguaje humano
  /** Traza de gates evaluados y su veredicto, para auditoría. */
  readonly traza: readonly { gate: string; ok: boolean; detalle?: string }[];
}

function deny(razon: string, explicacion: string, traza: ResultadoGate['traza']): ResultadoGate {
  return { decision: 'DENY', razon, explicacion, traza };
}

/**
 * Evalúa UNA acción propuesta contra el mandato y el contexto vigentes. Función PURA y determinista.
 * No ejecuta nada ni llama a ningún adaptador: es sólo la decisión.
 */
export function evaluarAccion(a: AccionPropuesta, ctx: ContextoEjecucion): ResultadoGate {
  const m = ctx.mandato;
  const t: { gate: string; ok: boolean; detalle?: string }[] = [];
  const meta = metaDeAccion(a.tipo);

  // 1 · Aislamiento de tenant.
  if (a.organizationId !== m.organizationId || a.businessKey !== m.businessKey || a.externalAccountId !== m.externalAccountId) {
    t.push({ gate: 'TENANT_BINDING', ok: false, detalle: `${a.organizationId}/${a.externalAccountId} ≠ mandato ${m.organizationId}/${m.externalAccountId}` });
    return deny('CROSS_TENANT', 'La acción no corresponde a la organización, negocio o cuenta del mandato.', t);
  }
  t.push({ gate: 'TENANT_BINDING', ok: true });

  // 2 · Credencial del mismo tenant.
  if (a.credentialRefOwnerOrg !== m.organizationId) {
    t.push({ gate: 'CREDENTIAL_OWNER', ok: false, detalle: a.credentialRefOwnerOrg });
    return deny('CREDENTIAL_MISMATCH', 'La credencial pertenece a otra organización.', t);
  }
  t.push({ gate: 'CREDENTIAL_OWNER', ok: true });

  // 3 · Mandato activo.
  if (m.status !== 'ACTIVE') {
    t.push({ gate: 'MANDATE_STATUS', ok: false, detalle: m.status });
    const razon = m.status === 'REVOKED' ? 'MANDATE_REVOKED' : m.status === 'PAUSED' ? 'AUTONOMY_PAUSED' : 'MANDATE_EXPIRED';
    return deny(razon, `El mandato está ${m.status}: ninguna acción procede.`, t);
  }
  t.push({ gate: 'MANDATE_STATUS', ok: true });

  // 4 · Interruptores de seguridad (kill switches). Se comprueban aquí y se re-comprobarán justo
  //     antes de cualquier mutación real.
  if (!ctx.interruptores.global || !ctx.interruptores.organizacion || !ctx.interruptores.cuentaExterna) {
    const cual = !ctx.interruptores.global ? 'GLOBAL' : !ctx.interruptores.organizacion ? 'ORGANIZATION' : 'EXTERNAL_ACCOUNT';
    t.push({ gate: 'KILL_SWITCH', ok: false, detalle: cual });
    return deny('KILL_SWITCH_OFF', `El interruptor de seguridad ${cual} está apagado: no hay ejecución real.`, t);
  }
  t.push({ gate: 'KILL_SWITCH', ok: true });

  // 5 · Expiración del mandato.
  if (!(m.validFrom <= ctx.ahora && ctx.ahora <= m.validUntil)) {
    t.push({ gate: 'MANDATE_WINDOW', ok: false, detalle: `${m.validFrom}..${m.validUntil}` });
    return deny('MANDATE_EXPIRED', 'El mandato no está vigente en este momento.', t);
  }
  t.push({ gate: 'MANDATE_WINDOW', ok: true });

  // 6 · Clasificación de la acción según el mandato.
  const clase = clasificarAccion(m, a.tipo);
  if (clase === 'FORBIDDEN') {
    t.push({ gate: 'ACTION_CLASS', ok: false, detalle: 'FORBIDDEN' });
    return deny('ACTION_FORBIDDEN', 'Esta acción está prohibida por el mandato.', t);
  }
  if (clase === 'NOT_IN_MANDATE') {
    t.push({ gate: 'ACTION_CLASS', ok: false, detalle: 'NOT_IN_MANDATE' });
    return deny('ACTION_NOT_IN_MANDATE', 'Esta acción no está incluida en el mandato (fail-closed).', t);
  }
  t.push({ gate: 'ACTION_CLASS', ok: true, detalle: clase });

  // 7 · Idempotencia: no ejecutar dos veces la misma acción.
  if (ctx.accionesYaEjecutadas.includes(a.actionId)) {
    t.push({ gate: 'IDEMPOTENCY', ok: false, detalle: a.actionId });
    return deny('DUPLICATE_ALREADY_EXECUTED', 'Esta acción ya fue ejecutada; no se repite.', t);
  }
  t.push({ gate: 'IDEMPOTENCY', ok: true });

  // 8 · Rollback disponible si la acción y la política lo exigen.
  if (meta.exigeRollback && m.politicaRollback.exigirParaMutaciones && !a.rollbackDisponible) {
    t.push({ gate: 'ROLLBACK', ok: false });
    return deny('ROLLBACK_UNAVAILABLE', 'No se puede generar un plan de reversión para esta acción.', t);
  }
  t.push({ gate: 'ROLLBACK', ok: true });

  // 9 · Presupuesto (guardarraíl financiero). Ausencia de límite requerido ⇒ DENY (nunca se infiere).
  if (meta.financiera) {
    const lf = m.limitesFinancieros;
    if (meta.aumentaGasto && lf.maxMonthlySpend === undefined && lf.maxDailySpend === undefined) {
      t.push({ gate: 'BUDGET', ok: false, detalle: 'NO_LIMIT' });
      return deny('FINANCIAL_LIMIT_NOT_CONFIGURED', 'No hay límite de gasto configurado: no se autoriza subir el gasto.', t);
    }
    const delta = a.montoCambio ?? 0;
    if (lf.maxSingleChangeAmount !== undefined && Math.abs(delta) > lf.maxSingleChangeAmount) {
      t.push({ gate: 'BUDGET', ok: false, detalle: 'SINGLE_CHANGE' });
      return deny('BUDGET_LIMIT_EXCEEDED', 'El cambio supera el monto máximo por cambio.', t);
    }
    if (meta.aumentaGasto && lf.maxDailySpend !== undefined && ctx.gastoDiario + delta > lf.maxDailySpend) {
      t.push({ gate: 'BUDGET', ok: false, detalle: 'DAILY' });
      return deny('BUDGET_LIMIT_EXCEEDED', 'El gasto diario proyectado supera el máximo configurado.', t);
    }
    if (meta.aumentaGasto && lf.maxMonthlySpend !== undefined && ctx.gastoMensual + delta > lf.maxMonthlySpend) {
      t.push({ gate: 'BUDGET', ok: false, detalle: 'MONTHLY' });
      return deny('BUDGET_LIMIT_EXCEEDED', 'El gasto mensual proyectado supera el máximo configurado.', t);
    }
    if (meta.aumentaGasto && lf.maxDailySpendIncreasePercent !== undefined && ctx.gastoDiarioPrevio > 0) {
      const incr = ((ctx.gastoDiario + delta - ctx.gastoDiarioPrevio) / ctx.gastoDiarioPrevio) * 100;
      if (incr > lf.maxDailySpendIncreasePercent) {
        t.push({ gate: 'BUDGET', ok: false, detalle: 'DAILY_PCT' });
        return deny('BUDGET_LIMIT_EXCEEDED', 'El aumento diario de gasto supera el porcentaje máximo.', t);
      }
    }
  }
  t.push({ gate: 'BUDGET', ok: true });

  // 10 · Velocidad de cambio. En LEVEL_3, exige tener configurado al menos el máximo diario.
  const lc = m.limitesCambio;
  if (nivelPermiteEjecucionAutonoma(m.nivel) && lc.maxChangesPerDay === undefined) {
    t.push({ gate: 'VELOCITY', ok: false, detalle: 'NO_LIMIT' });
    return deny('VELOCITY_LIMIT_NOT_CONFIGURED', 'No hay límite de velocidad de cambios configurado.', t);
  }
  if (lc.maxChangesPerHour !== undefined && ctx.cambiosUltimaHora >= lc.maxChangesPerHour) {
    t.push({ gate: 'VELOCITY', ok: false, detalle: 'HOUR' });
    return deny('CHANGE_VELOCITY_EXCEEDED', 'Se alcanzó el máximo de cambios por hora.', t);
  }
  if (lc.maxChangesPerDay !== undefined && ctx.cambiosHoy >= lc.maxChangesPerDay) {
    t.push({ gate: 'VELOCITY', ok: false, detalle: 'DAY' });
    return deny('CHANGE_VELOCITY_EXCEEDED', 'Se alcanzó el máximo de cambios por día.', t);
  }
  if (lc.maxChangesPerCampaignPerDay !== undefined && ctx.cambiosCampaniaHoy >= lc.maxChangesPerCampaignPerDay) {
    t.push({ gate: 'VELOCITY', ok: false, detalle: 'CAMPAIGN_DAY' });
    return deny('CHANGE_VELOCITY_EXCEEDED', 'Se alcanzó el máximo de cambios por campaña y día.', t);
  }
  t.push({ gate: 'VELOCITY', ok: true });

  // 11 · Cooldown activo.
  if (ctx.enCooldown) {
    t.push({ gate: 'COOLDOWN', ok: false });
    return deny('COOLDOWN_ACTIVE', 'La campaña está en período de enfriamiento tras un cambio reciente.', t);
  }
  t.push({ gate: 'COOLDOWN', ok: true });

  // 12 · Aprobación de otra organización nunca vale.
  if (a.aprobacion && a.aprobacion.porOrg !== m.organizationId) {
    t.push({ gate: 'APPROVAL_TENANT', ok: false, detalle: a.aprobacion.porOrg });
    return deny('APPROVAL_CROSS_TENANT', 'La aprobación proviene de otra organización.', t);
  }
  t.push({ gate: 'APPROVAL_TENANT', ok: true });

  // 13 · Evidencia suficiente. Una sola observación nunca basta.
  const pe = m.politicaEvidencia;
  const evOk =
    a.evidencia.muestra >= pe.muestraMinima &&
    a.evidencia.ventanaHoras >= pe.ventanaMinimaHoras &&
    (pe.confianzaMinima === undefined || (a.evidencia.confianza ?? 0) >= pe.confianzaMinima) &&
    (!pe.exigeRelevanciaConocida || a.evidencia.relevanciaConocida === true);
  if (!evOk) {
    t.push({ gate: 'EVIDENCE', ok: false, detalle: `muestra ${a.evidencia.muestra}/${pe.muestraMinima}` });
    return { decision: 'OBSERVE_MORE', razon: 'INSUFFICIENT_EVIDENCE', explicacion: 'Todavía no hay evidencia suficiente para actuar; SOEC sigue observando.', traza: t };
  }
  t.push({ gate: 'EVIDENCE', ok: true });

  // 14 · Nivel, reversibilidad y aprobación.
  const necesitaAprobacion =
    !nivelPermiteEjecucionAutonoma(m.nivel) || clase === 'APPROVAL_REQUIRED' || meta.reversibilidad === 'IRREVERSIBLE';
  if (necesitaAprobacion) {
    const apr = a.aprobacion;
    const aprobacionValida = apr !== null && apr !== undefined && apr.porOrg === m.organizationId && apr.expiraEn > ctx.ahora;
    if (!aprobacionValida) {
      const motivo = meta.reversibilidad === 'IRREVERSIBLE' ? 'acción irreversible' : clase === 'APPROVAL_REQUIRED' ? 'acción marcada para aprobación' : `nivel ${m.nivel}`;
      t.push({ gate: 'APPROVAL', ok: false, detalle: motivo });
      return { decision: 'REQUIRE_APPROVAL', razon: 'APPROVAL_REQUIRED', explicacion: `Requiere tu aprobación (${motivo}).`, traza: t };
    }
  }
  t.push({ gate: 'APPROVAL', ok: true });

  return { decision: 'EXECUTE', razon: 'ALL_GATES_PASSED', explicacion: 'Todas las condiciones del mandato se cumplen; sería ejecutable dentro de tus límites.', traza: t };
}
