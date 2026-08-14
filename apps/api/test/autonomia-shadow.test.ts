/**
 * SOEC · AUTONOMÍA · MODO SOMBRA con datos REALES (FASE A0). Sin efecto externo.
 *
 * Demuestra, con el perfil y los search terms reales de SmileFlow, que el modo sombra decide «qué
 * haría» usando los mismos gates que la ejecución futura, sin mutar nada; que «dentalink agenda» NO
 * se convierte en negativa por 0 clics; y que C Y P, sin fundamentos, no es elegible para autonomía.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluarElegibilidadMandato,
  INTERRUPTORES_TODOS_ON,
  type NivelAutonomia,
} from '@soec/autonomia';
import { construirMandatoConservador, evaluarSombraAds, type Termino } from '../src/autonomia/shadow-ads';
import {
  buscarFuentes,
  buscarPerfilComercial,
  buscarProfile,
  evaluarFundamentos,
  getBusiness,
  getProfile,
  getRecursoGoogleAds,
  ORG_SMILEFLOW,
} from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';

const AHORA = '2026-08-14T12:00:00.000Z';

/** Search terms REALES de SmileFlow (0 clics en su mayoría). */
const TERMINOS_SMILEFLOW: Termino[] = [
  { termino: 'dentalink agenda', impresiones: 35, clics: 0 },
  { termino: 'dentalink ingreso', impresiones: 22, clics: 0 },
  { termino: 'dentalink chile', impresiones: 20, clics: 1 },
  { termino: 'cariogram', impresiones: 16, clics: 0 },
  { termino: 'dentalsoft uno salud', impresiones: 11, clics: 0 },
];

function mandatoSmileFlow(nivel: NivelAutonomia = 'LEVEL_3_AUTONOMOUS') {
  return construirMandatoConservador({
    organizationId: ORG_SMILEFLOW,
    businessKey: getBusiness(ORG_SMILEFLOW).businessKey,
    externalAccountId: getRecursoGoogleAds(ORG_SMILEFLOW).customerId,
    limites: getProfile(ORG_SMILEFLOW).limitesAutonomia,
    nivel,
    ahora: AHORA,
    diasVigencia: 30,
  });
}

describe('Modo sombra · SmileFlow con datos reales', () => {
  it('TEST 19 · evalúa la situación real y NO muta nada (0 mutaciones externas)', () => {
    const r = evaluarSombraAds({
      mandato: mandatoSmileFlow(),
      interruptores: INTERRUPTORES_TODOS_ON,
      ahora: AHORA,
      gastoDiario: 400,
      gastoMensual: 12000,
      gastoDiarioPrevio: 400,
      cambiosHoy: 0,
      terminos: TERMINOS_SMILEFLOW,
    });
    expect(r.reporte.mutacionesExternas).toBe(0);
    expect(r.situacionesEvaluadas).toBe(5);
    // Sin política de irrelevancia, NINGUNA búsqueda se excluye ⇒ 0 acciones mutantes candidatas.
    expect(r.reporte.totalEvaluadas).toBe(0);
    expect(r.reporte.wouldExecute).toBe(0);
    // Pero SÍ hay oportunidades de «revisar el mensaje».
    expect(r.revisarMensaje).toBeGreaterThan(0);
  });

  it('TEST 20 · «dentalink agenda» (35 impresiones, 0 clics) NO se negativiza: es OPTIMIZAR_MENSAJE', () => {
    const r = evaluarSombraAds({
      mandato: mandatoSmileFlow(),
      interruptores: INTERRUPTORES_TODOS_ON,
      ahora: AHORA,
      gastoDiario: 400,
      gastoMensual: 12000,
      gastoDiarioPrevio: 400,
      cambiosHoy: 0,
      terminos: TERMINOS_SMILEFLOW,
    });
    const dentalink = r.evaluacionesTermino.find((e) => e.termino === 'dentalink agenda');
    expect(dentalink?.accion).toBe('OPTIMIZAR_MENSAJE');
    expect(dentalink?.accion).not.toBe('NEGATIVA_JUSTIFICADA');
    // Y no aparece como acción a ejecutar en la sombra.
    expect(r.reporte.decisiones.some((d) => d.actionId.includes('dentalink'))).toBe(false);
  });

  it('CON política de irrelevancia del negocio, un término irrelevante 0-clics SÍ sería ejecutable en sombra', () => {
    const r = evaluarSombraAds({
      mandato: mandatoSmileFlow(),
      interruptores: INTERRUPTORES_TODOS_ON,
      ahora: AHORA,
      gastoDiario: 400,
      gastoMensual: 12000,
      gastoDiarioPrevio: 400,
      cambiosHoy: 0,
      terminos: [{ termino: 'empleo dentista', impresiones: 40, clics: 0 }],
      politicaIrrelevancia: ['empleo'],
    });
    expect(r.reporte.totalEvaluadas).toBe(1);
    // SEARCH_TERM_EXCLUDE es reversible y está permitida ⇒ en LEVEL_3 sería ejecutable (en sombra).
    expect(r.reporte.wouldExecute).toBe(1);
    expect(r.reporte.mutacionesExternas).toBe(0);
  });

  it('TEST 21 · la decisión es función pura de los términos REALES (no de eventos de prueba de Growth)', () => {
    const entrada = {
      mandato: mandatoSmileFlow(),
      interruptores: INTERRUPTORES_TODOS_ON,
      ahora: AHORA,
      gastoDiario: 400,
      gastoMensual: 12000,
      gastoDiarioPrevio: 400,
      cambiosHoy: 0,
      terminos: TERMINOS_SMILEFLOW,
    };
    expect(evaluarSombraAds(entrada).reporte.wouldExecute).toBe(evaluarSombraAds(entrada).reporte.wouldExecute);
    expect(evaluarSombraAds(entrada).situacionesEvaluadas).toBe(5);
  });

  it('TEST 22/23 · sin términos (Director/fuente sin datos) ⇒ 0 acciones, jamás ejecuta por fallback', () => {
    const r = evaluarSombraAds({
      mandato: mandatoSmileFlow(),
      interruptores: INTERRUPTORES_TODOS_ON,
      ahora: AHORA,
      gastoDiario: 0,
      gastoMensual: 0,
      gastoDiarioPrevio: 0,
      cambiosHoy: 0,
      terminos: [],
    });
    expect(r.reporte.wouldExecute).toBe(0);
    expect(r.reporte.totalEvaluadas).toBe(0);
  });

  it('kill switch de la organización apagado ⇒ nada sería ejecutable, ni siquiera lo justificado', () => {
    const r = evaluarSombraAds({
      mandato: mandatoSmileFlow(),
      interruptores: { global: true, organizacion: false, cuentaExterna: true },
      ahora: AHORA,
      gastoDiario: 400,
      gastoMensual: 12000,
      gastoDiarioPrevio: 400,
      cambiosHoy: 0,
      terminos: [{ termino: 'empleo dentista', impresiones: 40, clics: 0 }],
      politicaIrrelevancia: ['empleo'],
    });
    expect(r.reporte.wouldExecute).toBe(0);
    expect(r.reporte.wouldDeny).toBe(1);
  });
});

describe('Elegibilidad · C Y P sin fundamentos', () => {
  it('TEST 18 · C Y P solicita LEVEL_3 ⇒ NOT_ELIGIBLE (fundamentos requeridos), no hereda de SmileFlow', () => {
    const negocio = getBusiness(ORG_CYP);
    const fundamentos = evaluarFundamentos(
      negocio,
      buscarFuentes(ORG_CYP),
      buscarPerfilComercial(ORG_CYP),
      buscarProfile(ORG_CYP) !== null,
      null,
    );
    const adsConectado = buscarFuentes(ORG_CYP).some((f) => f.tipo === 'ADS' && (f.estado === 'CONNECTED_READ_ONLY' || f.estado === 'OBSERVED'));

    const e = evaluarElegibilidadMandato({
      nivelSolicitado: 'LEVEL_3_AUTONOMOUS',
      fundamentosVeredicto: fundamentos.veredicto,
      cuentaPublicitariaConectada: adsConectado,
      motivosFundamentos: fundamentos.motivos.map((m) => m.codigo),
    });

    expect(fundamentos.veredicto).toBe('FOUNDATION_REQUIRED');
    expect(adsConectado).toBe(false);
    expect(e.elegible).toBe(false);
    expect(e.nivelConcedido).toBe('LEVEL_0_OBSERVE');
    expect(e.motivos).toContain('FOUNDATION_REQUIRED');
    // No menciona nada de SmileFlow.
    expect(JSON.stringify(e).toLowerCase()).not.toContain('smileflow');
  });
});
