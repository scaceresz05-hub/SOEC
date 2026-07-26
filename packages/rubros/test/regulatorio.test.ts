/**
 * Semántica regulatoria PRELIMINARY (criterio 5): puede advertir y bloquear
 * conservadoramente, pero NUNCA certificar. Solo una regla RATIFIED + VERIFIED es
 * certificable. La consulta regulatoria incluye las preliminares como advertencias.
 */
import { describe, it, expect } from 'vitest';
import type { Regulatorio } from '../src/index';
import {
  crearBibliotecaClinicaDental,
  semanticaRegulatoria,
  verificarCapacidadDeCertificacion,
  CertificacionNoPermitidaError,
} from '../src/index';
import { conocimientoClinicaDental } from '../src/rubros/clinica-dental';

describe('@soec/rubros · semántica regulatoria', () => {
  it('las reglas PRELIMINARY advierten y bloquean, pero no certifican', () => {
    for (const r of conocimientoClinicaDental.regulatorio) {
      const s = semanticaRegulatoria(r);
      expect(s.puedeAdvertir).toBe(true);
      expect(s.puedeBloquearConservador).toBe(true);
      expect(s.puedeCertificarCumplimiento).toBe(false);
    }
  });

  it('verificar la capacidad de certificación con una regla PRELIMINARY lanza', () => {
    const r = conocimientoClinicaDental.regulatorio[0]!;
    expect(() => verificarCapacidadDeCertificacion(r)).toThrow(CertificacionNoPermitidaError);
  });

  it('solo una regla RATIFIED + VERIFIED puede afirmar cumplimiento', () => {
    const certificable: Regulatorio = {
      ...conocimientoClinicaDental.regulatorio[0]!,
      estado: 'RATIFIED',
      verificacion: 'VERIFIED',
    };
    expect(verificarCapacidadDeCertificacion(certificable)).toBe(true);
  });

  it('la consulta regulatoria incluye las preliminares como advertencias', () => {
    const regs = crearBibliotecaClinicaDental().restriccionesRegulatorias();
    expect(regs.length).toBe(conocimientoClinicaDental.regulatorio.length);
    expect(regs.every((r) => r.tipo === 'regulatorio')).toBe(true);
  });
});
