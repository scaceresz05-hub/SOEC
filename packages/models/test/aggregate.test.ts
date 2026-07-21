import { describe, expect, it } from 'vitest';
import type { RecordedEvent } from '@soec/contracts';
import { EVENTOS, aplicar, estadoInicial, reconstruir } from '../src/domain/model';
import { attr } from './helpers';

function rec(overrides: Partial<RecordedEvent> & Pick<RecordedEvent, 'type' | 'payload' | 'sequence'>): RecordedEvent {
  return {
    eventId: `e${overrides.sequence}`,
    streamId: 'med:X',
    organizationId: 'orgA' as RecordedEvent['organizationId'],
    actor: 'a' as RecordedEvent['actor'],
    attribution: attr,
    occurredAt: '2026-01-01T00:00:00.000Z',
    recordedAt: `2026-01-0${overrides.sequence}T00:00:00.000Z`,
    correlationId: 'c',
    causationId: null,
    idempotencyKey: null,
    ...overrides,
  };
}

describe('Agregado de Modelo — invariantes de reducción', () => {
  it('una afirmación nace pendiente (no es hecho por existir, §9)', () => {
    const evs = [
      rec({ sequence: 1, type: EVENTOS.med.creada, payload: { ambito: { proposito: 'p', representa: 'r', excluye: '', supuestos: [] }, vigencia: { desde: 'x', hasta: null } } }),
      rec({ sequence: 2, type: EVENTOS.med.afirmacion, payload: { afirmacionId: 'a1', enunciado: 'algo', dimension: 'es', incertidumbre: 'alta' } }),
    ];
    const st = reconstruir('X', 'MED', 'orgA', evs);
    expect(st.afirmaciones['a1']?.estado).toBe('pendiente');
    expect(st.afirmaciones['a1']?.evidencias).toHaveLength(0);
  });

  it('la evidencia sobre una afirmación inexistente no altera el estado', () => {
    const evs = [
      rec({ sequence: 1, type: EVENTOS.med.creada, payload: { ambito: { proposito: 'p', representa: 'r', excluye: '', supuestos: [] }, vigencia: { desde: 'x', hasta: null } } }),
      rec({ sequence: 2, type: EVENTOS.med.evidencia, payload: { evidenciaId: 'ev1', afirmacionId: 'fantasma', relacion: 'sostiene', procedencia: 'src', contenido: 'c' } }),
    ];
    const st = reconstruir('X', 'MED', 'orgA', evs);
    expect(Object.keys(st.evidencias)).toHaveLength(0);
  });

  it('la revisión conserva el historial de estados (no sobrescribe)', () => {
    const evs = [
      rec({ sequence: 1, type: EVENTOS.med.creada, payload: { ambito: { proposito: 'p', representa: 'r', excluye: '', supuestos: [] }, vigencia: { desde: 'x', hasta: null } } }),
      rec({ sequence: 2, type: EVENTOS.med.afirmacion, payload: { afirmacionId: 'a1', enunciado: 'algo', dimension: 'es', incertidumbre: 'alta' } }),
      rec({ sequence: 3, type: EVENTOS.med.revision, payload: { afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'evidencia suficiente' } }),
      rec({ sequence: 4, type: EVENTOS.med.revision, payload: { afirmacionId: 'a1', nuevoEstado: 'superada', motivo: 'reemplazada', supersededBy: 'a2' } }),
    ];
    const st = reconstruir('X', 'MED', 'orgA', evs);
    expect(st.afirmaciones['a1']?.estado).toBe('superada');
    expect(st.afirmaciones['a1']?.supersededBy).toBe('a2');
    expect(st.afirmaciones['a1']?.historialEstados.map((h) => h.estado)).toEqual([
      'pendiente',
      'respaldada',
      'superada',
    ]);
  });

  it('la versión equivale al número de eventos aplicados (necesidad técnica)', () => {
    const st0 = estadoInicial('X', 'MED', 'orgA');
    expect(st0.version).toBe(0);
    const st = aplicar(st0, rec({ sequence: 1, type: 'evento.desconocido', payload: {} }));
    expect(st.version).toBe(1); // avanza versión aunque el evento no altere el dominio
    expect(st.existe).toBe(false);
  });
});
