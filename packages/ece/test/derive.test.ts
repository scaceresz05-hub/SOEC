import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { MedService } from '@soec/models';
import { derivarDeModelo } from '../src/domain/derive';
import { ambitoMed, cmdBase, ctxFor, vigencia } from './helpers';

async function medState(fn: (med: MedService, ctx: ReturnType<typeof ctxFor>) => Promise<void>) {
  const store = new InMemoryEventStore();
  const med = new MedService(store);
  const ctx = ctxFor('orgA');
  await med.crear(ctx, { instanceId: 'm', ambito: ambitoMed, vigencia, ...cmdBase });
  await fn(med, ctx);
  return med.estadoActual(ctx, 'm');
}

describe('Derivación determinística de elementos del ECE', () => {
  it('coherencia: afirmación respaldada sostenida por evidencia', async () => {
    const st = await medState(async (med, ctx) => {
      await med.emitirAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'baja', ...cmdBase });
      await med.incorporarEvidencia(ctx, { instanceId: 'm', evidenciaId: 'e1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'src', contenido: 'c', ...cmdBase });
      await med.revisarAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'ok', ...cmdBase });
    });
    const els = derivarDeModelo(st);
    expect(els).toHaveLength(1);
    expect(els[0]?.tipo).toBe('coherencia');
    expect(els[0]?.evidencia).toEqual(['e1']);
    expect(els[0]?.noEvaluable).toBe(false);
    expect(els[0]?.atribucion.source).toBe('fixture-sintetico'); // atribución conservada
  });

  it('contradicción: evidencia que sostiene y debilita la misma afirmación', async () => {
    const st = await medState(async (med, ctx) => {
      await med.emitirAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
      await med.incorporarEvidencia(ctx, { instanceId: 'm', evidenciaId: 'e-si', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...cmdBase });
      await med.incorporarEvidencia(ctx, { instanceId: 'm', evidenciaId: 'e-no', afirmacionId: 'a1', relacion: 'debilita', procedencia: 'B', contenido: 'c', ...cmdBase });
    });
    const els = derivarDeModelo(st);
    expect(els).toHaveLength(1);
    expect(els[0]?.tipo).toBe('contradiccion');
  });

  it('ausencia: afirmación pendiente sin evidencia queda no evaluable', async () => {
    const st = await medState(async (med, ctx) => {
      await med.emitirAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
    });
    const els = derivarDeModelo(st);
    expect(els).toHaveLength(1);
    expect(els[0]?.tipo).toBe('ausencia');
    expect(els[0]?.noEvaluable).toBe(true);
  });

  it('es reproducible: mismas entradas → mismos ids', async () => {
    const st = await medState(async (med, ctx) => {
      await med.emitirAfirmacion(ctx, { instanceId: 'm', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
    });
    expect(derivarDeModelo(st).map((e) => e.id)).toEqual(derivarDeModelo(st).map((e) => e.id));
    expect(derivarDeModelo(st)[0]?.id).toBe('der:ausencia:MED:m:a1');
  });
});
