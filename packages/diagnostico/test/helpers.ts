/**
 * Helpers de prueba: componen el motor sobre un EventStore EN MEMORIA con reloj FIJO
 * (determinismo), usando la biblioteca real del rubro «Clínica Dental» por defecto.
 */
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { crearBibliotecaClinicaDental } from '@soec/rubros';
import type { RubroKnowledgePort } from '@soec/rubros';
import {
  componerMotorDiagnostico,
  type MotorDiagnostico,
  type RespuestasDiagnostico,
} from '../src/index';

export const OCCURRED = '2026-07-22T12:00:00.000Z';

export function nuevoMotor(rubro: RubroKnowledgePort = crearBibliotecaClinicaDental()): {
  motor: MotorDiagnostico;
  rubro: RubroKnowledgePort;
} {
  const store = new InMemoryEventStore(new FixedClock(new Date('2026-07-22T00:00:00.000Z')));
  return { motor: componerMotorDiagnostico(store, rubro), rubro };
}

/** Respuestas de ejemplo para el rubro Clínica Dental (por índice de pregunta). */
export function respuestasEjemplo(preguntas: readonly string[]): RespuestasDiagnostico {
  return [
    {
      preguntaId: preguntas[0]!,
      tipo: 'afirmada',
      enunciado: 'Ofrece ortodoncia e implantes',
      sustento: 'catálogo de servicios',
    },
    {
      preguntaId: preguntas[2]!,
      tipo: 'contradictoria',
      enunciado: 'La agenda tiene holgura',
      aFavor: 'hay huecos reportados',
      enContra: 'la lista de espera crece',
    },
    { preguntaId: preguntas[3]!, tipo: 'ausente' },
    // preguntas[1] y preguntas[4] quedan SIN responder → faltante SIN_RESPUESTA.
  ];
}
