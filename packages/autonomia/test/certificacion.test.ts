/**
 * @soec/autonomia · CERTIFICACIÓN PRE-CANARY (A0.5). Ciclo completo end-to-end SIN efecto externo.
 *
 * Certifica el pipeline operacional con un adaptador FALSO: KEEP / ROLLBACK / ROLLBACK_FAILURE,
 * UNKNOWN_EXECUTION_RESULT sin reintento ciego, idempotencia PERSISTENTE (multiproceso + reinicio),
 * y TOCTOU (revalidación contra el mandato ACTUAL). `mutacionesExternas` = 0 siempre.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  AdaptadorCertificacion,
  ejecutarCicloCertificacion,
  evaluarAccion,
  INTERRUPTORES_TODOS_ON,
  LedgerEjecucion,
  type AccionPropuesta,
  type ContextoEjecucion,
  type MandatoAutonomia,
  type MedicionPosterior,
} from '../src/index';

const AHORA = '2026-08-14T12:00:00.000Z';
const MUESTRA_OK: MedicionPosterior = { muestra: 100, muestraMinima: 30, mejora: true };
const MUESTRA_PEOR: MedicionPosterior = { muestra: 100, muestraMinima: 30, mejora: false };
const MUESTRA_POCA: MedicionPosterior = { muestra: 5, muestraMinima: 30, mejora: true };

function mandato(over: Partial<MandatoAutonomia> = {}): MandatoAutonomia {
  return {
    organizationId: 'org-smileflow', businessKey: 'smileflow', externalAccountId: '8605539300',
    nivel: 'LEVEL_3_AUTONOMOUS',
    accionesPermitidas: ['SEARCH_TERM_EXCLUDE'], accionesRequierenAprobacion: [], accionesProhibidas: ['CAMPAIGN_CREATE'],
    limitesFinancieros: { maxDailySpend: 5000, maxSingleChangeAmount: 2000 },
    limitesCambio: { maxChangesPerDay: 5 },
    politicaEvidencia: { muestraMinima: 30, ventanaMinimaHoras: 72 },
    politicaRollback: { exigirParaMutaciones: true, ventanaMedicionHoras: 72 },
    politicaMedicion: { ventanaHoras: 72, metricaObjetivo: 'leads' },
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-12-31T23:59:59.000Z',
    createdBy: 'h', approvedBy: 'h', approvedAt: AHORA, status: 'ACTIVE', version: 1,
    ...over,
  };
}
function accion(over: Partial<AccionPropuesta> = {}): AccionPropuesta {
  return {
    actionId: 'SEARCH_TERM_EXCLUDE:8605539300:empleo', organizationId: 'org-smileflow', businessKey: 'smileflow',
    externalAccountId: '8605539300', targetId: '8605539300', tipo: 'SEARCH_TERM_EXCLUDE', desiredState: 'excluded',
    evidencia: { muestra: 40, ventanaHoras: 96 }, credentialRefOwnerOrg: 'org-smileflow', rollbackDisponible: true,
    aprobacion: null, mandateVersionVista: 1, ...over,
  };
}
function ctx(over: Partial<ContextoEjecucion> = {}): ContextoEjecucion {
  return {
    mandato: mandato(), interruptores: INTERRUPTORES_TODOS_ON, ahora: AHORA,
    gastoDiario: 400, gastoMensual: 4000, gastoDiarioPrevio: 400,
    cambiosUltimaHora: 0, cambiosHoy: 0, cambiosCampaniaHoy: 0, enCooldown: false, accionesYaEjecutadas: [],
    ...over,
  };
}
function reqctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

describe('Certificación · lifecycle KEEP / ROLLBACK / ROLLBACK_FAILURE', () => {
  it('KEEP: mutación aplicada + read-back OK + medición mejora ⇒ KEPT, 0 mutaciones externas', () => {
    const r = ejecutarCicloCertificacion(accion(), ctx(), 'EXITO', MUESTRA_OK);
    expect(r.estados).toContain('EXECUTED');
    expect(r.estados).toContain('MEASURING');
    expect(r.estados).toContain('KEPT');
    expect(r.readBackVerificado).toBe(true);
    expect(r.medicion).toBe('KEEP');
    expect(r.mutacionesExternas).toBe(0);
    expect(r.reintentoCiego).toBe(false);
  });

  it('ROLLBACK: medición empeora ⇒ se revierte (rollback OK) ⇒ ROLLED_BACK', () => {
    const r = ejecutarCicloCertificacion(accion(), ctx(), 'EXITO', MUESTRA_PEOR, { escenarioRollback: 'ROLLBACK_OK' });
    expect(r.medicion).toBe('ROLLBACK');
    expect(r.rollbackEjecutado).toBe(true);
    expect(r.rollbackExitoso).toBe(true);
    expect(r.estados).toContain('ROLLED_BACK');
    expect(r.autonomiaPausada).toBe(false);
  });

  it('ROLLBACK_FAILURE: si el rollback falla ⇒ PAUSA + ALERTA CRÍTICA + sin más acciones', () => {
    const r = ejecutarCicloCertificacion(accion(), ctx(), 'EXITO', MUESTRA_PEOR, { escenarioRollback: 'ROLLBACK_FALLA' });
    expect(r.rollbackEjecutado).toBe(true);
    expect(r.rollbackExitoso).toBe(false);
    expect(r.autonomiaPausada).toBe(true);
    expect(r.alertaCritica).toBe(true);
    expect(r.estados).toContain('PAUSED');
  });

  it('WAIT_MORE: muestra posterior insuficiente ⇒ sigue midiendo, no atribuye causalidad', () => {
    const r = ejecutarCicloCertificacion(accion(), ctx(), 'EXITO', MUESTRA_POCA);
    expect(r.medicion).toBe('WAIT_MORE');
    expect(r.rollbackEjecutado).toBe(false);
    expect(r.estados).not.toContain('KEPT');
  });

  it('READBACK_MISMATCH: aplicado pero el estado leído no coincide ⇒ se revierte', () => {
    const r = ejecutarCicloCertificacion(accion(), ctx(), 'READBACK_MISMATCH', MUESTRA_OK, { escenarioRollback: 'ROLLBACK_OK' });
    expect(r.readBackVerificado).toBe(false);
    expect(r.estados).toContain('ROLLED_BACK');
  });
});

describe('Certificación · resultado desconocido y fallos, sin reintento ciego', () => {
  for (const esc of ['TIMEOUT', 'AMBIGUO', 'CRASH_POST_ENVIO'] as const) {
    it(`${esc} ⇒ UNKNOWN_EXECUTION_RESULT, read-back requerido, target en pausa, sin reintento ciego`, () => {
      const ad = new AdaptadorCertificacion();
      const r = ejecutarCicloCertificacion(accion(), ctx(), esc, MUESTRA_OK, { adaptador: ad });
      expect(r.resultadoExterno).toBe('UNKNOWN');
      expect(r.estados).toContain('UNKNOWN_EXECUTION');
      expect(r.autonomiaPausada).toBe(true);
      expect(r.reintentoCiego).toBe(false);
      expect(r.intentosSimulados).toBe(1); // NO se reintenta a ciegas
      expect(r.mutacionesExternas).toBe(0);
    });
  }

  for (const esc of ['HTTP_500', 'HTTP_429'] as const) {
    it(`${esc} ⇒ FAILED limpio, sin reintento ciego`, () => {
      const r = ejecutarCicloCertificacion(accion(), ctx(), esc, MUESTRA_OK);
      expect(r.resultadoExterno).toBe('NOT_APPLIED');
      expect(r.estados).toContain('FAILED');
      expect(r.intentosSimulados).toBe(1);
    });
  }

  it('acción prohibida ⇒ el ciclo ni siquiera simula la mutación (0 intentos)', () => {
    const ad = new AdaptadorCertificacion();
    const r = ejecutarCicloCertificacion(accion({ tipo: 'CAMPAIGN_CREATE', actionId: 'x' }), ctx(), 'EXITO', MUESTRA_OK, { adaptador: ad });
    expect(r.decisionGate).toBe('DENY');
    expect(r.intentosSimulados).toBe(0);
    expect(r.mutacionesExternas).toBe(0);
  });
});

describe('Idempotencia PERSISTENTE · multiproceso y reinicio', () => {
  it('reservar dos veces el mismo actionId ⇒ RESERVED luego DUPLICATE', async () => {
    const store = new InMemoryEventStore();
    const led = new LedgerEjecucion(store);
    const c = reqctx('org-smileflow');
    expect(await led.reservar(c, 'a1', AHORA)).toBe('RESERVED');
    expect(await led.reservar(c, 'a1', AHORA)).toBe('DUPLICATE');
  });

  it('TWO_PROCESSES_SAME_ACTION ⇒ una sola reserva lógica', async () => {
    const store = new InMemoryEventStore();
    const c = reqctx('org-smileflow');
    const p1 = new LedgerEjecucion(store);
    const p2 = new LedgerEjecucion(store);
    const res = await Promise.all([p1.reservar(c, 'a2', AHORA), p2.reservar(c, 'a2', AHORA)]);
    expect(res.filter((x) => x === 'RESERVED')).toHaveLength(1);
    expect(res.filter((x) => x === 'DUPLICATE')).toHaveLength(1);
  });

  it('RESTART_SAFETY ⇒ un nuevo proceso lee lo reservado y no re-ejecuta', async () => {
    const store = new InMemoryEventStore();
    const c = reqctx('org-smileflow');
    await new LedgerEjecucion(store).reservar(c, 'a3', AHORA);
    const trasReinicio = new LedgerEjecucion(store); // mismo store persistido = «reinicio»
    expect(await trasReinicio.yaEjecutadas(c)).toContain('a3');
    expect(await trasReinicio.reservar(c, 'a3', AHORA)).toBe('DUPLICATE');
  });

  it('el ledger alimenta el gate: actionId reservado ⇒ DENY DUPLICATE', async () => {
    const store = new InMemoryEventStore();
    const c = reqctx('org-smileflow');
    const led = new LedgerEjecucion(store);
    await led.reservar(c, accion().actionId, AHORA);
    const r = evaluarAccion(accion(), ctx({ accionesYaEjecutadas: await led.yaEjecutadas(c) }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('DUPLICATE_ALREADY_EXECUTED');
  });
});

describe('TOCTOU · revalidación contra el mandato ACTUAL antes de mutar', () => {
  it('el humano baja el nivel a LEVEL_0 antes de ejecutar ⇒ ya NO se auto-ejecuta', () => {
    // t0: elegible en LEVEL_3
    expect(evaluarAccion(accion(), ctx()).decision).toBe('EXECUTE');
    // t2: mandato actual en LEVEL_0 ⇒ requiere aprobación (no auto-ejecuta)
    const r = evaluarAccion(accion(), ctx({ mandato: mandato({ nivel: 'LEVEL_0_OBSERVE' }) }));
    expect(r.decision).not.toBe('EXECUTE');
  });

  it('el mandato se revoca antes de ejecutar ⇒ DENY', () => {
    const r = ejecutarCicloCertificacion(accion(), ctx({ mandato: mandato({ status: 'REVOKED' }) }), 'EXITO', MUESTRA_OK);
    expect(r.decisionGate).toBe('DENY');
    expect(r.intentosSimulados).toBe(0);
  });

  it('el gasto sube y el nuevo cambio ya excede el límite ⇒ DENY en el recheck pre-mutate', () => {
    const fin = accion({ tipo: 'BID_ADJUST', actionId: 'bid1', montoCambio: 300 });
    const m = mandato({ accionesPermitidas: ['BID_ADJUST'], limitesFinancieros: { maxDailySpend: 5000, maxSingleChangeAmount: 2000 } });
    // t0: gasto diario 400 + 300 = 700 ≤ 5000 ⇒ EXECUTE
    expect(evaluarAccion(fin, ctx({ mandato: m, gastoDiario: 400 })).decision).toBe('EXECUTE');
    // t2: el gasto ya subió a 4900 ⇒ 4900 + 300 = 5200 > 5000 ⇒ DENY
    const r = evaluarAccion(fin, ctx({ mandato: m, gastoDiario: 4900 }));
    expect(r.decision).toBe('DENY');
    expect(r.razon).toBe('BUDGET_LIMIT_EXCEEDED');
  });
});
