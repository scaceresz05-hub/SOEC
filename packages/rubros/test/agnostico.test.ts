/**
 * Agnosticismo del motor (criterio 7): un rubro distinto se carga por la MISMA fábrica
 * genérica (`crearBiblioteca`, interna) sin modificar el motor ni introducir condiciones
 * por slug. Prueba que la lógica no está acoplada a «Clínica Dental».
 */
import { describe, it, expect } from 'vitest';
import { crearBiblioteca } from '../src/domain/port';
import { rubroMinimo } from './fixtures/rubro-minimo';

describe('@soec/rubros · motor agnóstico del rubro', () => {
  it('carga un rubro distinto por la misma frontera', () => {
    const port = crearBiblioteca(rubroMinimo);
    expect(port.rubroId()).toBe('rubro-demo');
    expect(port.version().biblioteca).toBe('0.1.0');
    expect(port.version().huellaCompleta).toMatch(/^[0-9a-f]{64}$/);
  });

  it('responde las mismas consultas de dominio para el rubro alternativo', () => {
    const port = crearBiblioteca(rubroMinimo);
    expect(port.objetivosElegibles().map((o) => o.id)).toEqual(['OBJ-DEMO-01']);
    expect(port.estrategiasDe('OBJ-DEMO-01').map((e) => e.id)).toEqual(['EST-DEMO-01']);
    expect(port.preguntasDiagnosticas()).toEqual(['¿Pregunta demo?']);
    expect(port.supuestos().map((s) => s.id)).toEqual(['SUP-DEMO-01']);
  });
});
