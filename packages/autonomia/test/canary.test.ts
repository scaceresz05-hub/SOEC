/**
 * @soec/autonomia · CONTROLLED REAL CANARY — STANDBY (tests). Sin efecto externo.
 *
 * Certifica la última milla en reposo: whitelist de capacidad, credencial de escritura fail-closed,
 * pre-mutate revalidation, staleness, rollback preciso, y ABSTENCIÓN como resultado válido. Con
 * WRITE apagado y sin credencial, `puedeMutar` es SIEMPRE false.
 */
import { describe, expect, it } from 'vitest';
import {
  candidatoVigente,
  esCapacidadCanaryPermitida,
  estadoCapacidadWrite,
  evaluarCandidatoCanary,
  evaluarFrescura,
  LIMITES_CANARY,
  notificacionDeCandidatoCanary,
  preMutateCheck,
  severidadNotificacion,
  verificarReadBack,
  type AccionPropuesta,
  type ContextoEjecucion,
  type CredencialWrite,
  type MandatoAutonomia,
} from '../src/index';

const AHORA = '2026-08-14T12:00:00.000Z';

function mandato(over: Partial<MandatoAutonomia> = {}): MandatoAutonomia {
  return {
    organizationId: 'org-smileflow', businessKey: 'smileflow', externalAccountId: '8605539300',
    nivel: 'LEVEL_3_AUTONOMOUS',
    accionesPermitidas: ['SEARCH_TERM_EXCLUDE'], accionesRequierenAprobacion: [], accionesProhibidas: [],
    limitesFinancieros: { maxDailySpend: 5000 }, limitesCambio: { maxChangesPerDay: 5 },
    politicaEvidencia: { muestraMinima: 30, ventanaMinimaHoras: 72 },
    politicaRollback: { exigirParaMutaciones: true, ventanaMedicionHoras: 72 },
    politicaMedicion: { ventanaHoras: 72, metricaObjetivo: 'leads' },
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-12-31T23:59:59.000Z',
    createdBy: 'h', approvedBy: 'h', approvedAt: AHORA, status: 'ACTIVE', version: 1, ...over,
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
    mandato: mandato(), interruptores: { global: true, organizacion: true, cuentaExterna: true }, ahora: AHORA,
    gastoDiario: 400, gastoMensual: 4000, gastoDiarioPrevio: 400, cambiosUltimaHora: 0, cambiosHoy: 0,
    cambiosCampaniaHoy: 0, enCooldown: false, accionesYaEjecutadas: [], ...over,
  };
}
const credWriteOK: CredencialWrite = {
  credentialRef: 'vault:org-smileflow/google-ads-write', organizationId: 'org-smileflow', provider: 'google-ads',
  externalAccountId: '8605539300', permissionScope: 'WRITE', capabilities: ['ADD_NEGATIVE_KEYWORD_EXACT'],
};

describe('Canary · whitelist de capacidad', () => {
  it('WRITE_ADAPTER_CAPABILITY_WHITELIST: sólo la capacidad reversible está permitida', () => {
    expect(esCapacidadCanaryPermitida('SEARCH_TERM_EXCLUDE')).toBe(true);
    for (const t of ['BUDGET_TOTAL_INCREASE', 'CAMPAIGN_CREATE', 'CAMPAIGN_PAUSE', 'BID_ADJUST'] as const) {
      expect(esCapacidadCanaryPermitida(t)).toBe(false);
    }
  });
  it('FINANCIAL_ACTIONS_FORBIDDEN / ONE_REAL_ACTION_MAX: límites duros', () => {
    expect(esCapacidadCanaryPermitida('BUDGET_TOTAL_INCREASE')).toBe(false);
    expect(LIMITES_CANARY.MAX_REAL_ACTIONS).toBe(1);
    expect(LIMITES_CANARY.MAX_CAMPAIGNS_TOUCHED).toBe(1);
    expect(LIMITES_CANARY.FINANCIAL_IMPACT_MAX).toBe(0);
  });
});

describe('Canary · credencial de escritura fail-closed', () => {
  it('NO_WRITE_CREDENTIAL_FAILS_CLOSED: sin credencial ⇒ NOT_READY', () => {
    expect(estadoCapacidadWrite(null, 'org-smileflow', '8605539300', 'ADD_NEGATIVE_KEYWORD_EXACT').estado).toBe('NOT_READY');
    const sinRef: CredencialWrite = { ...credWriteOK, credentialRef: null };
    expect(estadoCapacidadWrite(sinRef, 'org-smileflow', '8605539300', 'ADD_NEGATIVE_KEYWORD_EXACT').estado).toBe('NOT_READY');
  });
  it('WRITE_CREDENTIAL_TENANT_SCOPED: credencial de otra org/cuenta ⇒ NOT_READY', () => {
    expect(estadoCapacidadWrite(credWriteOK, 'org-cyp', '8605539300', 'ADD_NEGATIVE_KEYWORD_EXACT').motivo).toBe('WRITE_CREDENTIAL_CROSS_TENANT');
    expect(estadoCapacidadWrite(credWriteOK, 'org-smileflow', '9999999999', 'ADD_NEGATIVE_KEYWORD_EXACT').estado).toBe('NOT_READY');
  });
  it('no reutiliza la credencial de LECTURA', () => {
    const lectura: CredencialWrite = { ...credWriteOK, credentialRef: 'env:GOOGLE_ADS_REFRESH_TOKEN' };
    expect(estadoCapacidadWrite(lectura, 'org-smileflow', '8605539300', 'ADD_NEGATIVE_KEYWORD_EXACT').motivo).toBe('LOOKS_LIKE_READ_CREDENTIAL');
  });
  it('credencial WRITE correcta ⇒ READY (pero mutar aún exige el interruptor maestro)', () => {
    expect(estadoCapacidadWrite(credWriteOK, 'org-smileflow', '8605539300', 'ADD_NEGATIVE_KEYWORD_EXACT').estado).toBe('READY');
  });
});

describe('Canary · candidato y abstención', () => {
  it('NO_ELIGIBLE_ACTION_MEANS_NO_CANARY: acción no ejecutable (kill switch) ⇒ NONE', () => {
    const r = evaluarCandidatoCanary(accion(), ctx({ interruptores: { global: false, organizacion: true, cuentaExterna: true } }), 'cmp');
    expect(r.estado).toBe('NONE');
  });
  it('FINANCIAL / no-whitelisted ⇒ NONE', () => {
    const m = mandato({ accionesPermitidas: ['BID_ADJUST'] });
    const r = evaluarCandidatoCanary(accion({ tipo: 'BID_ADJUST', actionId: 'b', montoCambio: 10 }), ctx({ mandato: m }), 'cmp');
    expect(r.estado).toBe('NONE');
  });
  it('una acción reversible, no financiera, whitelisted y ejecutable ⇒ CANDIDATE con rollback preciso', () => {
    const r = evaluarCandidatoCanary(accion(), ctx(), 'cmp-1');
    expect(r.estado).toBe('CANDIDATE');
    if (r.estado === 'CANDIDATE') {
      expect(r.candidato.capability).toBe('ADD_NEGATIVE_KEYWORD_EXACT');
      // ROLLBACK_ONLY_REMOVES_CREATED_ENTITY
      expect(r.candidato.rollbackPlan.tipo).toBe('REMOVE_ONLY_ENTITY_CREATED_BY_ACTION_ID');
      expect(r.candidato.rollbackPlan.actionId).toBe(accion().actionId);
      expect(r.candidato.rollbackPlan.createdResourceName).toBeNull(); // se completa tras ejecutar
    }
  });
});

describe('Canary · pre-mutate revalidation (siempre DENY hoy)', () => {
  function candidato() {
    const r = evaluarCandidatoCanary(accion(), ctx(), 'cmp-1');
    if (r.estado !== 'CANDIDATE') throw new Error('esperado candidato');
    return r.candidato;
  }
  it('AUTONOMOUS_REAL_FALSE_MEANS_ZERO_MUTATIONS: con todo OK pero interruptor maestro OFF ⇒ no muta', () => {
    const pre = preMutateCheck({ candidato: candidato(), accion: accion(), ctx: ctx(), credWrite: credWriteOK, autonomousReal: false, evidenciaActual: { muestra: 40, mandateVersion: 1 } });
    expect(pre.puedeMutar).toBe(false);
    expect(pre.razon).toBe('REAL_EXECUTION_OFF');
  });
  it('sin credencial de escritura ⇒ no muta (aunque el maestro estuviera ON)', () => {
    const pre = preMutateCheck({ candidato: candidato(), accion: accion(), ctx: ctx(), credWrite: null, autonomousReal: true, evidenciaActual: { muestra: 40, mandateVersion: 1 } });
    expect(pre.puedeMutar).toBe(false);
    expect(pre.writeEstado).toBe('NOT_READY');
  });
  it('STALE_CANDIDATE_CANNOT_EXECUTE: la evidencia cambió ⇒ no muta', () => {
    const pre = preMutateCheck({ candidato: candidato(), accion: accion(), ctx: ctx(), credWrite: credWriteOK, autonomousReal: true, evidenciaActual: { muestra: 41, mandateVersion: 1 } });
    expect(pre.puedeMutar).toBe(false);
    expect(pre.frescura).toBe('STALE');
  });
  it('mandato superado (otra versión) ⇒ SUPERSEDED, no muta', () => {
    expect(evaluarFrescura(candidato(), { muestra: 40, mandateVersion: 2 })).toBe('SUPERSEDED');
  });
  it('PRE_MUTATE_REVALIDATION: si el mandato se revocó justo antes ⇒ no muta', () => {
    const pre = preMutateCheck({ candidato: candidato(), accion: accion(), ctx: ctx({ mandato: mandato({ status: 'REVOKED' }) }), credWrite: credWriteOK, autonomousReal: true, evidenciaActual: { muestra: 40, mandateVersion: 1 } });
    expect(pre.puedeMutar).toBe(false);
    expect(pre.razon).toBe('MANDATE_REVOKED');
  });
});

describe('Canary · read-back requerido', () => {
  it('READ_BACK_REQUIRED: verificado sólo si el estado real coincide', () => {
    expect(verificarReadBack('excluded', 'excluded').verificado).toBe(true);
    expect(verificarReadBack('excluded', 'otro').verificado).toBe(false);
    expect(verificarReadBack('excluded', null).verificado).toBe(false); // sin lectura ⇒ no verificado
  });
});

describe('Canary · expiración y notificación', () => {
  it('un candidato expira: fuera de su ventana ya no es ejecutable', () => {
    const r = evaluarCandidatoCanary(accion(), ctx(), 'cmp-1');
    if (r.estado !== 'CANDIDATE') throw new Error('esperado candidato');
    expect(candidatoVigente(r.candidato, AHORA)).toBe(true);
    expect(candidatoVigente(r.candidato, '2027-01-01T00:00:00.000Z')).toBe(false); // vencido
  });
  it('un candidato listo se notifica como IMPORTANTE (manage-by-exception), no como ruido', () => {
    const n = notificacionDeCandidatoCanary();
    expect(n.categoria).toBe('CANARY_CANDIDATE_READY');
    expect(n.severidad).toBe('IMPORTANT');
    expect(severidadNotificacion('CRITICAL')).toBe('CRITICAL');
    expect(severidadNotificacion('INFO')).toBe('INFO');
  });
});
