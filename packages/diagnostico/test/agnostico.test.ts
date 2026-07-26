/**
 * Agnosticismo del rubro (límite): un `RubroKnowledgePort` distinto (otro rubro, otras
 * preguntas) se procesa por el MISMO motor, sin condicionales por slug ni conocimiento
 * sectorial embebido. El puerto es de solo lectura; su huella no cambia.
 */
import { describe, it, expect } from 'vitest';
import type { RubroKnowledgePort } from '@soec/rubros';
import { nuevoMotor, OCCURRED } from './helpers';

/** Puerto de rubro hecho a mano (no Clínica Dental) para probar agnosticismo. */
function portFalso(): RubroKnowledgePort {
  return {
    rubroId: () => 'otro-rubro',
    version: () => ({
      biblioteca: '9.9.9',
      huellaCompleta: 'f'.repeat(64),
      huellaCorta: 'f'.repeat(12),
    }),
    objetivosElegibles: () => [],
    estrategiasDe: () => [],
    metricas: () => [],
    embudos: () => [],
    supuestos: () => [],
    restriccionesGenerales: () => [],
    restriccionesRegulatorias: () => [],
    preguntasDiagnosticas: () => ['¿Pregunta A?', '¿Pregunta B?'],
    senales: () => [],
    mapeos: () => [],
  };
}

describe('@soec/diagnostico · agnóstico del rubro', () => {
  it('procesa un rubro distinto por la misma frontera, sin condicionales por slug', async () => {
    const { motor } = nuevoMotor(portFalso());
    const comp = await motor.comprender(
      [
        {
          preguntaId: '¿Pregunta A?',
          tipo: 'afirmada',
          enunciado: 'algo cierto',
          sustento: 'porque sí',
        },
      ],
      { diagnosticoId: 'dx-otro', occurredAt: OCCURRED },
    );
    expect(comp.rubroId).toBe('otro-rubro');
    expect(comp.hechos.map((h) => h.preguntaId)).toEqual(['¿Pregunta A?']);
    // ¿Pregunta B? sin responder → faltante SIN_RESPUESTA.
    expect(
      comp.faltantes.some((f) => f.preguntaId === '¿Pregunta B?' && f.motivo === 'SIN_RESPUESTA'),
    ).toBe(true);
  });
});
