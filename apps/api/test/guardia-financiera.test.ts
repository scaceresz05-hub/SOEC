/**
 * GUARDIA FINANCIERA — lo que sí se puede prometer sobre el dinero de alguien, y lo que no.
 *
 * El mandato de CP dice dos cosas a la vez: 30.000 en total y 2.500 como máximo en un día. Google no ofrece
 * ninguna configuración que cumpla las dos: su presupuesto diario es un PROMEDIO —puede gastar el doble en un
 * día— y su presupuesto total de campaña no tiene límite diario. Elegir una en silencio sería incumplir la
 * otra mitad de lo que la persona autorizó.
 *
 * Estas pruebas fijan las tres decisiones que salen de ahí: se le declara a Google la mitad del tope diario,
 * se frena ANTES del total contando el gasto que todavía no se ve, y NUNCA se afirma que el total esté
 * garantizado al peso.
 */
import { describe, expect, it } from 'vitest';
import {
  FACTOR_DIARIO_GOOGLE,
  evaluarGuardiaFinanciera,
  gastoCiegoMaximoMinor,
  presupuestoMedioParaGoogle,
  promesaSobreElTotal,
} from '../src/accion/guardia-financiera';

/** El mandato real de CP: 30.000 en total, 2.500 al día. */
const CP = { totalMinor: 30_000, diarioMinor: 2_500 };

describe('el límite diario de Google no es un límite', () => {
  it('a un tope humano de 2.500 se le declara a Google 1.250', () => {
    expect(presupuestoMedioParaGoogle(2_500)).toBe(1_250);
  });

  it('el doble de lo declarado es exactamente el tope humano: por construcción no puede pasarse', () => {
    const medio = presupuestoMedioParaGoogle(CP.diarioMinor);
    expect(medio * FACTOR_DIARIO_GOOGLE).toBe(CP.diarioMinor);
  });

  it('nunca se declara a Google más que la mitad del tope humano, sea cual sea el tope', () => {
    for (const tope of [1_000, 2_500, 3_333, 10_000, 999_999]) {
      expect(presupuestoMedioParaGoogle(tope) * FACTOR_DIARIO_GOOGLE).toBeLessThanOrEqual(tope);
    }
  });
});

describe('el gasto que todavía no se ve', () => {
  it('se acota con el MÁXIMO diario, no con el promedio: acotar con el caso medio no acota nada', () => {
    // 2.500/día de tope humano ⇒ Google puede gastar hasta 5.000 en 24 h ⇒ ~208 por hora.
    expect(gastoCiegoMaximoMinor(CP, 24)).toBe(5_000);
    expect(gastoCiegoMaximoMinor(CP, 12)).toBe(2_500);
    expect(gastoCiegoMaximoMinor(CP, 0)).toBe(0);
  });

  it('una antigüedad negativa no produce un margen inventado', () => {
    expect(gastoCiegoMaximoMinor(CP, -5)).toBe(0);
  });
});

describe('cuándo se frena', () => {
  it('con margen holgado, se continúa y se dice cuánto queda en el peor caso', () => {
    const r = evaluarGuardiaFinanciera(CP, { gastoObservadoMinor: 5_000, antiguedadHoras: 6 });
    expect(r.veredicto).toBe('CONTINUAR');
    expect(r.gastoPosibleMinor).toBe(5_000 + gastoCiegoMaximoMinor(CP, 6));
    expect(r.margenMinor).toBeGreaterThan(0);
  });

  it('se frena ANTES de llegar al total, contando lo que pudo gastarse sin verse', () => {
    // Observado 28.000 y 12 h de retraso ⇒ podría haberse gastado 2.500 más ⇒ 30.500 > 30.000.
    const r = evaluarGuardiaFinanciera(CP, { gastoObservadoMinor: 28_000, antiguedadHoras: 12 });
    expect(r.veredicto).toBe('FRENAR_AHORA');
    expect(r.explicacion).toMatch(/se frena antes de comprobarlo/i);
  });

  it('si lo observado ya alcanza el total, se detiene sin más', () => {
    const r = evaluarGuardiaFinanciera(CP, { gastoObservadoMinor: 30_000, antiguedadHoras: 0 });
    expect(r.veredicto).toBe('AGOTADO');
    expect(r.margenMinor).toBe(0);
  });

  it('el umbral de frenado es el total menos el peor caso de un ciclo, no una proporción inventada', () => {
    const r = evaluarGuardiaFinanciera(CP, { gastoObservadoMinor: 0, antiguedadHoras: 12 });
    expect(r.umbralDeFrenadoMinor).toBe(CP.totalMinor - gastoCiegoMaximoMinor(CP, 12));
  });
});

describe('lo que NO se promete', () => {
  it('ningún veredicto declara garantía dura del total', () => {
    for (const observado of [0, 10_000, 29_999, 30_000, 45_000]) {
      const r = evaluarGuardiaFinanciera(CP, { gastoObservadoMinor: observado, antiguedadHoras: 8 });
      expect(r.garantiaDura, 'no existe garantía matemática del total con esta plataforma').toBe(false);
    }
  });

  it('la frase para la persona dice el riesgo con un número, y no promete el importe exacto', () => {
    const t = promesaSobreElTotal(CP, 12);
    expect(t).toContain('2500'); // el peor caso, calculado, no un adjetivo
    expect(t).toMatch(/no se puede prometer el importe exacto/i);
    expect(t).not.toMatch(/garantizad/i);
  });
});
