/**
 * Solo se ejecuta el mecanismo determinista (criterio ratificado): ninguna operación
 * fue producida por un mecanismo distinto de `determinístico`.
 */
import { describe, it, expect } from 'vitest';
import { nuevoMotor, respuestasEjemplo, OCCURRED } from './helpers';

describe('@soec/diagnostico · solo mecanismo determinista', () => {
  it('cada operación ejecutada usa el mecanismo determinístico', async () => {
    const { motor, rubro } = nuevoMotor();
    const comp = await motor.comprender(respuestasEjemplo(rubro.preguntasDiagnosticas()), {
      diagnosticoId: 'dx-det',
      occurredAt: OCCURRED,
    });
    expect(comp.operaciones.length).toBeGreaterThan(0);
    expect(comp.operaciones.some((o) => o.mecanismo === 'determinístico')).toBe(true);
    for (const o of comp.operaciones) {
      expect(
        o.mecanismo === null || o.mecanismo === 'determinístico',
        `mecanismo inesperado: ${o.mecanismo}`,
      ).toBe(true);
    }
  });
});
