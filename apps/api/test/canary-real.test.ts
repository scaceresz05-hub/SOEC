/**
 * SOEC · CONTROLLED REAL CANARY — STANDBY con perfiles REALES (sin efecto externo).
 *
 * La credencial de escritura NO está configurada (fail-closed); C Y P no puede usar la escritura de
 * SmileFlow; con los datos reales de SmileFlow no hay candidato (abstención = PASS); y aunque hubiera
 * uno, hoy no puede mutar (AUTONOMOUS_REAL=false + WRITE NOT_READY).
 */
import { describe, expect, it } from 'vitest';
import { AUTONOMOUS_REAL } from '@soec/cia';
import { estadoCapacidadWrite, INTERRUPTORES_TODOS_ON } from '@soec/autonomia';
import { credencialWriteDe, evaluarCanaryReal } from '../src/autonomia/canary-real';
import { construirMandatoConservador, type EntradaSombraAds, type Termino } from '../src/autonomia/shadow-ads';
import { getBusiness, getProfile, getRecursoGoogleAds, ORG_SMILEFLOW } from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';

const AHORA = '2026-08-14T12:00:00.000Z';
const TERMINOS: Termino[] = [
  { termino: 'dentalink agenda', impresiones: 35, clics: 0 },
  { termino: 'dentalink chile', impresiones: 20, clics: 1 },
];

function entrada(over: Partial<EntradaSombraAds> = {}): EntradaSombraAds {
  const mandato = construirMandatoConservador({
    organizationId: ORG_SMILEFLOW,
    businessKey: getBusiness(ORG_SMILEFLOW).businessKey,
    externalAccountId: getRecursoGoogleAds(ORG_SMILEFLOW).customerId,
    limites: getProfile(ORG_SMILEFLOW).limitesAutonomia,
    nivel: 'LEVEL_3_AUTONOMOUS',
    ahora: AHORA,
    diasVigencia: 30,
  });
  return {
    mandato, interruptores: INTERRUPTORES_TODOS_ON, ahora: AHORA,
    gastoDiario: 400, gastoMensual: 12000, gastoDiarioPrevio: 400, cambiosHoy: 0,
    terminos: TERMINOS, ...over,
  };
}

describe('Canary real · credencial fail-closed y aislamiento', () => {
  it('NO_WRITE_CREDENTIAL_FAILS_CLOSED: SmileFlow no tiene token de escritura ⇒ NOT_READY', () => {
    const cred = credencialWriteDe(ORG_SMILEFLOW);
    expect(cred?.credentialRef).toBeNull();
    expect(estadoCapacidadWrite(cred, ORG_SMILEFLOW, getRecursoGoogleAds(ORG_SMILEFLOW).customerId, 'ADD_NEGATIVE_KEYWORD_EXACT').estado).toBe('NOT_READY');
  });

  it('CYP_CANNOT_USE_SMILEFLOW_WRITE: C Y P sin Ads no tiene credencial de escritura', () => {
    expect(credencialWriteDe(ORG_CYP)).toBeNull();
    // Y la credencial de SmileFlow no vale para la cuenta de C Y P.
    const credSF = credencialWriteDe(ORG_SMILEFLOW);
    const conRef = credSF ? { ...credSF, credentialRef: 'vault:org-smileflow/write' } : null;
    expect(estadoCapacidadWrite(conRef, ORG_CYP, '8605539300', 'ADD_NEGATIVE_KEYWORD_EXACT').motivo).toBe('WRITE_CREDENTIAL_CROSS_TENANT');
  });
});

describe('Canary real · abstención y standby con datos reales', () => {
  it('SHADOW→CANARY: sin política de irrelevancia, SmileFlow no produce candidato (NONE = PASS)', () => {
    const r = evaluarCanaryReal(ORG_SMILEFLOW, entrada());
    expect(r.candidato).toBe('NONE');
    expect(r.puedeMutarHoy).toBe(false);
    expect(r.writeEstado).toBe('NOT_READY');
    expect(r.autonomousReal).toBe(false);
  });

  it('CANARY_INFRA_READY_DOES_NOT_FORCE_ACTION: aunque hubiera un candidato, hoy NO puede mutar', () => {
    // Con una política de irrelevancia del negocio, un término irrelevante 0-clics SÍ sería candidato...
    const r = evaluarCanaryReal(ORG_SMILEFLOW, entrada({ terminos: [{ termino: 'empleo dentista', impresiones: 40, clics: 0 }], politicaIrrelevancia: ['empleo'] }));
    expect(r.candidato).toBe('CANDIDATE');
    // ...pero puedeMutarHoy es false: sin credencial de escritura y con el interruptor maestro apagado.
    expect(r.puedeMutarHoy).toBe(false);
    expect(r.writeEstado).toBe('NOT_READY');
  });

  it('AUTONOMOUS_REAL_FALSE_MEANS_ZERO_MUTATIONS: el interruptor maestro sigue apagado', () => {
    expect(AUTONOMOUS_REAL).toBe(false);
  });
});
