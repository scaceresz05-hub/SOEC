import { describe, expect, it } from 'vitest';
import { evaluarGuardrail, UMBRAL_WARNING } from '../src/autonomia-ads/guardrail-financiero';

// Caso real que originó el P0: cap NUNCA registrado; presupuesto diario 2000; gasto ~31.839; 0 contactos.
const CASO_INCIDENTE = { gastoActual: 31839, capAutorizado: null, contactosReales: 0 };

describe('guardrail financiero — cap total humano vs presupuesto diario Google', () => {
  it('google_daily_budget_is_not_human_total_cap: el presupuesto diario NO es entrada; sin cap total ⇒ SIN_CAP', () => {
    // evaluarGuardrail no recibe el presupuesto diario: el cap es SIEMPRE el total autorizado por el humano.
    // Un diario de 2000 no puede convertirse en el tope: sin cap total registrado, el estado es SIN_CAP_AUTORIZADO.
    const r = evaluarGuardrail({ gastoActual: 100000, capAutorizado: null, contactosReales: 0 });
    expect(r.estado).toBe('SIN_CAP_AUTORIZADO');
    expect(r.ratio).toBeNull();
  });

  it('no_historical_cap_is_invented: sin cap registrado, no se inventa (ni retroactivo) y se dice la verdad', () => {
    const r = evaluarGuardrail(CASO_INCIDENTE);
    expect(r.estado).toBe('SIN_CAP_AUTORIZADO');
    expect(r.decisionRequerida).toBe(false);
    expect(r.mensaje).toContain('No había un presupuesto total autorizado registrado en SOEC');
    // NO afirma que se superó un cap inexistente.
    expect(r.mensaje).not.toContain('alcanzó el presupuesto');
    expect(r.estado).not.toBe('CAP_REACHED');
  });

  it('spend_below_80_is_normal', () => {
    const r = evaluarGuardrail({ gastoActual: 20000, capAutorizado: 30000, contactosReales: 0 });
    expect(r.estado).toBe('NORMAL');
    expect(r.decisionRequerida).toBe(false);
  });

  it('spend_at_80_creates_warning', () => {
    const r = evaluarGuardrail({ gastoActual: 24000, capAutorizado: 30000, contactosReales: 0 });
    expect(r.ratio).toBeCloseTo(UMBRAL_WARNING, 6);
    expect(r.estado).toBe('WARNING');
    expect(r.decisionRequerida).toBe(false);
    expect(r.mensaje).toContain('24.000'); // "Has utilizado $24.000 de los $30.000 autorizados"
    expect(r.mensaje).toContain('30.000');
  });

  it('spend_at_100_requires_decision', () => {
    const r = evaluarGuardrail({ gastoActual: 30000, capAutorizado: 30000, contactosReales: 5 });
    expect(r.estado).toBe('CAP_REACHED');
    expect(r.decisionRequerida).toBe(true);
    expect(r.recomendacion).toBe('PAUSE_AND_DIAGNOSE');
    expect(r.tipoDecision).toBe('BUDGET_CAP_REACHED');
  });

  it('zero_contacts_at_cap_requires_decision', () => {
    const r = evaluarGuardrail({ gastoActual: 30137, capAutorizado: 30000, contactosReales: 0 });
    expect(r.estado).toBe('CAP_REACHED');
    expect(r.decisionRequerida).toBe(true); // 0 contactos NO oculta el problema
    expect(r.recomendacion).toBe('PAUSE_AND_DIAGNOSE');
  });

  it('cap_decision_overrides_insufficient_data: cap alcanzado con 0 conversiones EXIGE decisión (prevalece)', () => {
    // "insufficient data" (0 conversiones) NO puede suprimir la decisión cuando el cap se consumió.
    const conCap = evaluarGuardrail({ gastoActual: 31000, capAutorizado: 30000, contactosReales: 0 });
    expect(conCap.decisionRequerida).toBe(true);
    // Sin cap, en cambio, no hay decisión de presupuesto que forzar (verdad conservada).
    const sinCap = evaluarGuardrail({ gastoActual: 31000, capAutorizado: null, contactosReales: 0 });
    expect(sinCap.decisionRequerida).toBe(false);
  });

  it('soec_autonomous_real_remains_false: el guardrail sólo RECOMIENDA; nunca ejecuta la pausa', () => {
    const r = evaluarGuardrail({ gastoActual: 40000, capAutorizado: 30000, contactosReales: 0 });
    // Es una recomendación (PAUSE_AND_DIAGNOSE), no una acción ejecutada. El resultado no tiene campo de ejecución.
    expect(r.recomendacion).toBe('PAUSE_AND_DIAGNOSE');
    expect(Object.keys(r)).not.toContain('ejecutado');
    expect(Object.keys(r)).not.toContain('accionEjecutada');
    expect(Object.keys(r)).not.toContain('mutacion');
  });
});
