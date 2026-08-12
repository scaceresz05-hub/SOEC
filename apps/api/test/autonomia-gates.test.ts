import { describe, expect, it } from 'vitest';
import { evaluarGates, type ContextoGates } from '../src/autonomia-ads/gates';
import { LIMITES_SMILEFLOW } from '../src/autonomia-ads/limites-smileflow';
import type { IntencionDeCambio } from '../src/autonomia-ads/intencion';

const CUSTOMER = '24120966895';
const intencion = (over: Partial<IntencionDeCambio> = {}): IntencionDeCambio => ({
  id: 'i1', org: 'org-smileflow', customerId: CUSTOMER, campaniaRef: 'cmp', palanca: 'agregar_negativa', entidadRef: 't',
  habilitacionEtapa: 'HABILITADA_G1_DRYRUN', autorizacionRequerida: 'HUMANA_POR_CAMBIO', riesgo: 'bajo', confianza: 'alta',
  problema: 'p', recomendacion: 'r', impactoEsperado: 'i', riesgoExplicacion: 're', rollbackPrevisto: 'rb',
  valorAntes: 'a', valorDespues: 'd', unidad: 'término', evidencia: { resumen: 'e', muestra: 40, suficiente: true },
  limitesAplicados: [], detalleTecnico: { operacion: 'op', descripcionMutate: 'm' }, ...over,
});
const ctx = (over: Partial<ContextoGates> = {}): ContextoGates => ({
  autonomousReal: false, killSwitchActivo: false, pausado: false, nivelAutonomia: 'EJECUTAR_CON_APROBACION',
  autorizacionVigente: true, limiteDisponible: true, aprobacionHumana: true, cambiosHoy: 0, cooldownVigente: false,
  customerIdAutorizado: CUSTOMER, ...over,
});

describe('evaluarGates', () => {
  it('G1: interruptor maestro apagado ⇒ puedeEjecutarReal=false y modo DRY_RUN (aunque todo lo demás pase)', () => {
    const r = evaluarGates(intencion(), ctx(), LIMITES_SMILEFLOW);
    expect(r.modo).toBe('DRY_RUN');
    expect(r.puedeEjecutarReal).toBe(false);
    expect(r.bloqueos).toContain('INTERRUPTOR_MAESTRO_REAL');
  });

  it('CONFINAMIENTO_TENANT: un customerId distinto al autorizado bloquea', () => {
    const r = evaluarGates(intencion({ customerId: '9999999999' }), ctx(), LIMITES_SMILEFLOW);
    expect(r.bloqueos).toContain('CONFINAMIENTO_TENANT');
  });

  it('INVARIANTE_SEGURIDAD: una acción NUNCA nunca pasa', () => {
    const r = evaluarGates(intencion({ autorizacionRequerida: 'NUNCA' }), ctx(), LIMITES_SMILEFLOW);
    expect(r.bloqueos).toContain('INVARIANTE_SEGURIDAD');
  });

  it('HABILITACION_ETAPA: una acción NO habilitada esta etapa no pasa', () => {
    const r = evaluarGates(intencion({ habilitacionEtapa: 'NO_HABILITADA_ETAPA' }), ctx(), LIMITES_SMILEFLOW);
    expect(r.bloqueos).toContain('HABILITACION_ETAPA');
  });

  it('KILL_SWITCH y MODO_SEGURO bloquean', () => {
    expect(evaluarGates(intencion(), ctx({ killSwitchActivo: true }), LIMITES_SMILEFLOW).bloqueos).toContain('KILL_SWITCH');
    expect(evaluarGates(intencion(), ctx({ pausado: true }), LIMITES_SMILEFLOW).bloqueos).toContain('MODO_SEGURO');
  });

  it('NIVEL_AUTONOMIA: perfil CONSERVADOR (RECOMENDAR) no autoriza ejecutar una acción humana', () => {
    const r = evaluarGates(intencion(), ctx({ nivelAutonomia: 'RECOMENDAR' }), LIMITES_SMILEFLOW);
    expect(r.bloqueos).toContain('NIVEL_AUTONOMIA');
  });

  it('APROBACION_HUMANA: sin aprobación, una acción humana no pasa', () => {
    const r = evaluarGates(intencion(), ctx({ aprobacionHumana: false }), LIMITES_SMILEFLOW);
    expect(r.bloqueos).toContain('APROBACION_HUMANA');
  });

  it('LIMITES: superar cambios/día o cooldown activo bloquea', () => {
    expect(evaluarGates(intencion(), ctx({ cambiosHoy: 2 }), LIMITES_SMILEFLOW).bloqueos).toContain('LIMITES_FRECUENCIA_COOLDOWN');
    expect(evaluarGates(intencion(), ctx({ cooldownVigente: true }), LIMITES_SMILEFLOW).bloqueos).toContain('LIMITES_FRECUENCIA_COOLDOWN');
  });

  it('acción automática exige confianza ALTA (media no basta)', () => {
    const auto = intencion({ autorizacionRequerida: 'AUTOMATICA_BAJO_RIESGO', confianza: 'media' });
    const r = evaluarGates(auto, ctx({ nivelAutonomia: 'EJECUTAR_AUTOMATICO' }), LIMITES_SMILEFLOW);
    expect(r.bloqueos).toContain('EVIDENCIA_CONFIANZA');
  });
});
