/**
 * @soec/autonomia · mandato · TESTS ADVERSARIALES del guardián de autonomía (FASE A0).
 *
 * Demuestran que el pipeline de gates es fail-closed y tenant-scoped: ante la duda, no ejecuta.
 * Cubren los casos de la directiva (1..19, 24, 25) que son puros de dominio; la regresión de
 * razonamiento (dentalink), la contaminación de tests de Growth y el bloqueo end-to-end de C Y P
 * con datos reales viven en apps/api (wiring real).
 */
import { describe, expect, it } from 'vitest';
import {
  evaluarAccion,
  evaluarElegibilidadMandato,
  evaluarSombra,
  INTERRUPTORES_TODOS_ON,
  type AccionPropuesta,
  type ContextoEjecucion,
  type MandatoAutonomia,
} from '../src/index';

const AHORA = '2026-08-14T12:00:00.000Z';

function mandato(over: Partial<MandatoAutonomia> = {}): MandatoAutonomia {
  return {
    organizationId: 'org-smileflow',
    businessKey: 'smileflow',
    externalAccountId: '8605539300',
    nivel: 'LEVEL_3_AUTONOMOUS',
    accionesPermitidas: ['SEARCH_TERM_EXCLUDE', 'AD_PAUSE', 'BID_ADJUST'],
    accionesRequierenAprobacion: ['BUDGET_TOTAL_INCREASE'],
    accionesProhibidas: ['CAMPAIGN_CREATE'],
    limitesFinancieros: { maxMonthlySpend: 100000, maxDailySpend: 5000, maxSingleChangeAmount: 2000, maxDailySpendIncreasePercent: 20 },
    limitesCambio: { maxChangesPerDay: 5, maxChangesPerHour: 2, maxChangesPerCampaignPerDay: 3, cooldownAfterChangeMinutes: 4320 },
    politicaEvidencia: { muestraMinima: 30, ventanaMinimaHoras: 72 },
    politicaRollback: { exigirParaMutaciones: true, ventanaMedicionHoras: 72 },
    politicaMedicion: { ventanaHoras: 72, metricaObjetivo: 'leads' },
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.000Z',
    createdBy: 'humano-1',
    approvedBy: 'humano-1',
    approvedAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    version: 3,
    ...over,
  };
}

function accion(over: Partial<AccionPropuesta> = {}): AccionPropuesta {
  return {
    actionId: 'SEARCH_TERM_EXCLUDE:24120966895:empleo',
    organizationId: 'org-smileflow',
    businessKey: 'smileflow',
    externalAccountId: '8605539300',
    targetId: '24120966895',
    tipo: 'SEARCH_TERM_EXCLUDE',
    desiredState: 'excluded',
    evidencia: { muestra: 40, ventanaHoras: 96 },
    credentialRefOwnerOrg: 'org-smileflow',
    rollbackDisponible: true,
    aprobacion: null,
    mandateVersionVista: 3,
    ...over,
  };
}

function ctx(over: Partial<ContextoEjecucion> = {}): ContextoEjecucion {
  return {
    mandato: mandato(),
    interruptores: INTERRUPTORES_TODOS_ON,
    ahora: AHORA,
    gastoDiario: 1000,
    gastoMensual: 20000,
    gastoDiarioPrevio: 1000,
    cambiosUltimaHora: 0,
    cambiosHoy: 0,
    cambiosCampaniaHoy: 0,
    enCooldown: false,
    accionesYaEjecutadas: [],
    ...over,
  };
}

describe('gates · camino feliz (no todo es DENY)', () => {
  it('acción permitida, con evidencia, dentro de límites, LEVEL_3 ⇒ EXECUTE', () => {
    const r = evaluarAccion(accion(), ctx());
    expect(r.decision).toBe('EXECUTE');
  });
});

describe('gates · aislamiento entre organizaciones', () => {
  it('TEST 1 · mandato SmileFlow no sirve para una acción de C Y P ⇒ DENY CROSS_TENANT', () => {
    const r = evaluarAccion(accion({ organizationId: 'org-cyp' }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('CROSS_TENANT');
  });

  it('TEST 2 · cuenta externa de SmileFlow no ejecuta desde otra cuenta ⇒ DENY CROSS_TENANT', () => {
    const r = evaluarAccion(accion({ externalAccountId: '9999999999' }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('CROSS_TENANT');
  });

  it('TEST 13 · credentialRef de otro tenant ⇒ DENY CREDENTIAL_MISMATCH', () => {
    const r = evaluarAccion(accion({ credentialRefOwnerOrg: 'org-cyp' }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('CREDENTIAL_MISMATCH');
  });

  it('TEST 25 · tenant desconocido ⇒ fail closed (DENY)', () => {
    const r = evaluarAccion(accion({ organizationId: 'org-desconocida' }), ctx());
    expect(r.decision).toBe('DENY');
  });
});

describe('gates · mandato, interruptores y expiración', () => {
  it('TEST 3 · acción no incluida en el mandato ⇒ DENY ACTION_NOT_IN_MANDATE', () => {
    const r = evaluarAccion(accion({ tipo: 'KEYWORD_PAUSE', actionId: 'KEYWORD_PAUSE:x:y' }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('ACTION_NOT_IN_MANDATE');
  });

  it('acción prohibida por el mandato ⇒ DENY ACTION_FORBIDDEN', () => {
    const r = evaluarAccion(accion({ tipo: 'CAMPAIGN_CREATE', actionId: 'CAMPAIGN_CREATE:x' }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('ACTION_FORBIDDEN');
  });

  it('TEST 4 · mandato expirado ⇒ DENY MANDATE_EXPIRED', () => {
    const r = evaluarAccion(accion(), ctx({ mandato: mandato({ validUntil: '2026-06-01T00:00:00.000Z' }) }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('MANDATE_EXPIRED');
  });

  it('TEST 5 · kill switch (global OFF) ⇒ DENY KILL_SWITCH_OFF', () => {
    const r = evaluarAccion(accion(), ctx({ interruptores: { global: false, organizacion: true, cuentaExterna: true } }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('KILL_SWITCH_OFF');
  });

  it('kill switch de la CUENTA OFF ⇒ DENY', () => {
    const r = evaluarAccion(accion(), ctx({ interruptores: { global: true, organizacion: true, cuentaExterna: false } }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('KILL_SWITCH_OFF');
  });

  it('TEST 17 · autonomía revocada ⇒ DENY MANDATE_REVOKED', () => {
    const r = evaluarAccion(accion(), ctx({ mandato: mandato({ status: 'REVOKED' }) }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('MANDATE_REVOKED');
  });

  it('mandato en PAUSA ⇒ DENY AUTONOMY_PAUSED (la pausa gana)', () => {
    const r = evaluarAccion(accion(), ctx({ mandato: mandato({ status: 'PAUSED' }) }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('AUTONOMY_PAUSED');
  });
});

describe('gates · límites financieros y de velocidad', () => {
  it('TEST 6 · cambio financiero que supera el máximo por cambio ⇒ DENY BUDGET_LIMIT_EXCEEDED', () => {
    const r = evaluarAccion(accion({ tipo: 'BID_ADJUST', actionId: 'BID_ADJUST:x', montoCambio: 5000 }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('BUDGET_LIMIT_EXCEEDED');
  });

  it('TEST 24 · presupuesto desconocido (sin límite) + acción que sube gasto ⇒ DENY FINANCIAL_LIMIT_NOT_CONFIGURED', () => {
    const r = evaluarAccion(
      accion({ tipo: 'BID_ADJUST', actionId: 'BID_ADJUST:x', montoCambio: 100 }),
      ctx({ mandato: mandato({ limitesFinancieros: {} }) }),
    );
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('FINANCIAL_LIMIT_NOT_CONFIGURED');
  });

  it('TEST 7 · velocidad de cambios superada ⇒ DENY CHANGE_VELOCITY_EXCEEDED', () => {
    const r = evaluarAccion(accion(), ctx({ cambiosHoy: 5 }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('CHANGE_VELOCITY_EXCEEDED');
  });

  it('LEVEL_3 sin límite de velocidad configurado ⇒ DENY VELOCITY_LIMIT_NOT_CONFIGURED', () => {
    const r = evaluarAccion(accion(), ctx({ mandato: mandato({ limitesCambio: {} }) }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('VELOCITY_LIMIT_NOT_CONFIGURED');
  });

  it('TEST 8 · cooldown activo ⇒ DENY COOLDOWN_ACTIVE', () => {
    const r = evaluarAccion(accion(), ctx({ enCooldown: true }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('COOLDOWN_ACTIVE');
  });
});

describe('gates · evidencia, reversibilidad y aprobación', () => {
  it('TEST 9 · evidencia insuficiente ⇒ OBSERVE_MORE (nunca EXECUTE)', () => {
    const r = evaluarAccion(accion({ evidencia: { muestra: 5, ventanaHoras: 96 } }), ctx());
    expect(r.decision).toBe('OBSERVE_MORE');
    expect(r.razon).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('TEST 22/23 · Director/fuente sin datos (muestra 0) ⇒ OBSERVE_MORE, jamás abre ejecución por fallback', () => {
    const r = evaluarAccion(accion({ evidencia: { muestra: 0, ventanaHoras: 0 } }), ctx());
    expect(r.decision).toBe('OBSERVE_MORE');
    expect(r.decision).not.toBe('EXECUTE');
  });

  it('TEST 10 · acción irreversible (permitida) sin aprobación ⇒ REQUIRE_APPROVAL', () => {
    const m = mandato({ accionesPermitidas: ['CAMPAIGN_CREATE'], accionesProhibidas: [] });
    const r = evaluarAccion(accion({ tipo: 'CAMPAIGN_CREATE', actionId: 'CAMPAIGN_CREATE:x', montoCambio: 100 }), ctx({ mandato: m }));
    expect(r.decision).toBe('REQUIRE_APPROVAL');
  });

  it('acción marcada APPROVAL_REQUIRED sin aprobación ⇒ REQUIRE_APPROVAL', () => {
    const r = evaluarAccion(accion({ tipo: 'BUDGET_TOTAL_INCREASE', actionId: 'BUDGET_TOTAL_INCREASE:x', montoCambio: 100 }), ctx());
    expect(r.decision).toBe('REQUIRE_APPROVAL');
  });

  it('LEVEL_2 ⇒ toda acción ejecutable requiere aprobación', () => {
    const r = evaluarAccion(accion(), ctx({ mandato: mandato({ nivel: 'LEVEL_2_APPROVAL_REQUIRED' }) }));
    expect(r.decision).toBe('REQUIRE_APPROVAL');
  });

  it('TEST 11 · rollback requerido pero no disponible ⇒ DENY ROLLBACK_UNAVAILABLE', () => {
    const r = evaluarAccion(accion({ rollbackDisponible: false }), ctx());
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('ROLLBACK_UNAVAILABLE');
  });

  it('TEST 12 · aprobación de otra organización ⇒ DENY APPROVAL_CROSS_TENANT', () => {
    const r = evaluarAccion(
      accion({ aprobacion: { porOrg: 'org-cyp', actorHumano: 'x', otorgadaEn: AHORA, expiraEn: '2026-12-31T00:00:00.000Z' } }),
      ctx({ mandato: mandato({ nivel: 'LEVEL_2_APPROVAL_REQUIRED' }) }),
    );
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('APPROVAL_CROSS_TENANT');
  });

  it('aprobación válida de la MISMA organización ⇒ EXECUTE (LEVEL_2)', () => {
    const r = evaluarAccion(
      accion({ aprobacion: { porOrg: 'org-smileflow', actorHumano: 'Dra. Ana', otorgadaEn: AHORA, expiraEn: '2026-12-31T00:00:00.000Z' } }),
      ctx({ mandato: mandato({ nivel: 'LEVEL_2_APPROVAL_REQUIRED' }) }),
    );
    expect(r.decision).toBe('EXECUTE');
  });
});

describe('gates · idempotencia y concurrencia', () => {
  it('TEST 14/15 · actionId ya ejecutado (retry/overlap) ⇒ DENY DUPLICATE, no segunda ejecución', () => {
    const a = accion();
    const primera = evaluarAccion(a, ctx());
    expect(primera.decision).toBe('EXECUTE');
    // El scheduler vuelve a intentar la MISMA acción tras registrarla como ejecutada:
    const segunda = evaluarAccion(a, ctx({ accionesYaEjecutadas: [a.actionId] }));
    expect(segunda.decision).toBe('DENY');
    expect(segunda.razon).toBe('DUPLICATE_ALREADY_EXECUTED');
  });
});

describe('gates · TOCTOU (el mandato vigente manda)', () => {
  it('TEST 16 · acción generada bajo v1 pero el mandato v2 la quitó ⇒ DENY con el mandato ACTUAL', () => {
    // La intención se generó con mandateVersionVista=3 cuando la acción estaba permitida.
    // El mandato ACTUAL (v4) ya no la incluye: la revalidación usa el mandato vigente.
    const mandatoNuevo = mandato({ version: 4, accionesPermitidas: ['AD_PAUSE'] }); // SEARCH_TERM_EXCLUDE removido
    const r = evaluarAccion(accion({ mandateVersionVista: 3 }), ctx({ mandato: mandatoNuevo }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('ACTION_NOT_IN_MANDATE');
  });
});

describe('elegibilidad · fundamentos', () => {
  it('TEST 18 · C Y P sin fundamentos solicita LEVEL_3 ⇒ NOT_ELIGIBLE, se concede sólo observar', () => {
    const e = evaluarElegibilidadMandato({
      nivelSolicitado: 'LEVEL_3_AUTONOMOUS',
      fundamentosVeredicto: 'FOUNDATION_REQUIRED',
      cuentaPublicitariaConectada: false,
      motivosFundamentos: ['ADS_NOT_CONFIGURED', 'ANALYTICS_NOT_CONFIGURED', 'ECONOMICS_UNKNOWN'],
    });
    expect(e.elegible).toBe(false);
    expect(e.nivelConcedido).toBe('LEVEL_0_OBSERVE');
    expect(e.motivos).toContain('FOUNDATION_REQUIRED');
    expect(e.motivos).toContain('ADS_ACCOUNT_NOT_CONNECTED');
  });

  it('SmileFlow evaluable + cuenta conectada solicita LEVEL_3 ⇒ ELIGIBLE', () => {
    const e = evaluarElegibilidadMandato({
      nivelSolicitado: 'LEVEL_3_AUTONOMOUS',
      fundamentosVeredicto: 'EVALUABLE',
      cuentaPublicitariaConectada: true,
      motivosFundamentos: [],
    });
    expect(e.elegible).toBe(true);
    expect(e.nivelConcedido).toBe('LEVEL_3_AUTONOMOUS');
  });

  it('observar/recomendar siempre elegibles (no ejecutan nada externo)', () => {
    for (const n of ['LEVEL_0_OBSERVE', 'LEVEL_1_RECOMMEND'] as const) {
      const e = evaluarElegibilidadMandato({ nivelSolicitado: n, fundamentosVeredicto: 'FOUNDATION_REQUIRED', cuentaPublicitariaConectada: false, motivosFundamentos: [] });
      expect(e.elegible).toBe(true);
    }
  });
});

describe('modo sombra · 0 mutaciones', () => {
  it('TEST 19 · evaluarSombra usa los mismos gates y nunca muta (mutacionesExternas = 0)', () => {
    const acciones: AccionPropuesta[] = [
      accion(), // EXECUTE
      accion({ actionId: 'a2', evidencia: { muestra: 5, ventanaHoras: 96 } }), // OBSERVE_MORE
      accion({ actionId: 'a3', tipo: 'BUDGET_TOTAL_INCREASE', montoCambio: 100 }), // REQUIRE_APPROVAL
      accion({ actionId: 'a4', tipo: 'CAMPAIGN_CREATE' }), // DENY (forbidden)
    ];
    const rep = evaluarSombra(acciones, ctx());
    expect(rep.mutacionesExternas).toBe(0);
    expect(rep.totalEvaluadas).toBe(4);
    expect(rep.wouldExecute).toBe(1);
    expect(rep.wouldObserveMore).toBe(1);
    expect(rep.wouldRequireApproval).toBe(1);
    expect(rep.wouldDeny).toBe(1);
    // Cada decisión deja traza auditable (por qué).
    expect(rep.decisiones.every((d) => d.traza.length > 0 && d.explicacion.length > 0)).toBe(true);
  });
});
