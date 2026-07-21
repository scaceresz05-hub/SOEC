import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { MedService } from '../src/app/services';
import { ambitoMed, attr, ctxFor, vigencia } from './helpers';

const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

async function medConAfirmacion() {
  const store = new InMemoryEventStore();
  const med = new MedService(store);
  const ctx = ctxFor('orgA');
  await med.crear(ctx, { instanceId: 'm', ambito: ambitoMed, vigencia, ...base });
  await med.emitirAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', enunciado: 'afirmación bajo prueba', dimension: 'hace', incertidumbre: 'media', limitacion: 'solo turno diurno', ...base });
  return { med, ctx };
}

describe('Afirmaciones y evidencias — primera clase (§9)', () => {
  it('una afirmación no se vuelve hecho por existir: nace pendiente y conserva su limitación', async () => {
    const { med, ctx } = await medConAfirmacion();
    const st = await med.estadoActual(ctx, 'm');
    expect(st.afirmaciones['a1']?.estado).toBe('pendiente');
    expect(st.afirmaciones['a1']?.limitacion).toBe('solo turno diurno');
  });

  it('recorre respaldada → cuestionada → superada sin borrar la historia', async () => {
    const { med, ctx } = await medConAfirmacion();
    await med.revisarAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'evidencia inicial', ...base });
    await med.revisarAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', nuevoEstado: 'cuestionada', motivo: 'evidencia en contra', ...base });
    await med.emitirAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a2', enunciado: 'reemplazo', dimension: 'hace', incertidumbre: 'baja', ...base });
    await med.revisarAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', nuevoEstado: 'superada', motivo: 'reemplazada por a2', supersededBy: 'a2', ...base });
    const st = await med.estadoActual(ctx, 'm');
    expect(st.afirmaciones['a1']?.estado).toBe('superada');
    expect(st.afirmaciones['a1']?.supersededBy).toBe('a2');
    expect(st.afirmaciones['a1']?.historialEstados.map((h) => h.estado)).toEqual([
      'pendiente',
      'respaldada',
      'cuestionada',
      'superada',
    ]);
  });

  it('admite evidencia conflictiva sin resolverla automáticamente', async () => {
    const { med, ctx } = await medConAfirmacion();
    await med.incorporarEvidencia(ctx, { instanceId: 'm', evidenciaId: 'e-si', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'fuente A', contenido: 'apoya', ...base });
    await med.incorporarEvidencia(ctx, { instanceId: 'm', evidenciaId: 'e-no', afirmacionId: 'a1', relacion: 'debilita', procedencia: 'fuente B', contenido: 'contradice', ...base });
    const st = await med.estadoActual(ctx, 'm');
    // Ambas evidencias coexisten; el estado NO se decide solo (no integra comprensión, #12).
    expect([...(st.afirmaciones['a1']?.evidencias ?? [])].sort()).toEqual(['e-no', 'e-si']);
    expect(st.evidencias['e-si']?.relacion).toBe('sostiene');
    expect(st.evidencias['e-no']?.relacion).toBe('debilita');
    expect(st.afirmaciones['a1']?.estado).toBe('pendiente'); // sigue pendiente: nadie la elevó
  });

  it('evidencia inconclusa deja la afirmación insuficiente (pendiente)', async () => {
    const { med, ctx } = await medConAfirmacion();
    await med.incorporarEvidencia(ctx, { instanceId: 'm', evidenciaId: 'e1', afirmacionId: 'a1', relacion: 'inconclusa', procedencia: 'parcial', contenido: 'no concluye', ...base });
    const st = await med.estadoActual(ctx, 'm');
    expect(st.afirmaciones['a1']?.estado).toBe('pendiente');
    expect(st.evidencias['e1']?.relacion).toBe('inconclusa');
  });
});
