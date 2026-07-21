import { describe, expect, it } from 'vitest';
import { evaluarAutorizacion } from '../src/domain/authorization';
import { estadoInicialPolicy, reconstruirPolicy } from '../src/domain/policy';
import type { AccionPropuesta } from '../src/domain/action';
import { InMemoryEventStore } from '@soec/event-store';
import { attr, ctxFor, montar, politicaBase, politicaVigente, now } from './helpers';

async function estadoDePolitica(mut?: (p: typeof politicaBase) => typeof politicaBase) {
  const m = montar(new InMemoryEventStore());
  const ctx = ctxFor('orgA');
  await politicaVigente(m, ctx, 'pol-1', mut ? mut(politicaBase) : politicaBase);
  return reconstruirPolicy('pol-1', 'orgA', await m.store.readStream(ctx, 'pol:pol-1'));
}
const accion = (over: Partial<AccionPropuesta> = {}): AccionPropuesta => ({
  tipo: 'publicar_organico',
  canal: 'blog',
  contenido: 'contenido válido',
  costo: 0,
  productoIntelectualRef: 'ref-1',
  ...over,
});

describe('Motor de autorización — permitir/denegar con motivo', () => {
  it('sin política → denegada (sin_politica)', () => {
    const d = evaluarAutorizacion(estadoInicialPolicy('x', 'orgA'), accion(), 0);
    expect(d.permitida).toBe(false);
    expect(d.motivo).toBe('sin_politica');
  });

  it('acción cubierta por política vigente → permitida', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion(), 0);
    expect(d.permitida).toBe(true);
    expect(d.policyVersion).toBe(1);
  });

  it('canal no autorizado → denegada', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion({ canal: 'tiktok' }), 0);
    expect(d.motivo).toBe('canal_no_autorizado');
  });

  it('tipo prohibido → denegada', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion({ tipo: 'enviar_masivo' }), 0);
    expect(d.motivo).toBe('accion_prohibida');
  });

  it('afirmación prohibida en el contenido → denegada', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion({ contenido: 'resultado GARANTIZADO' }), 0);
    expect(d.motivo).toBe('afirmacion_prohibida');
  });

  it('acción que requiere aprobación → denegada', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion({ tipo: 'modificar_landing' }), 0);
    expect(d.motivo).toBe('requiere_aprobacion');
  });

  it('alto riesgo → requiere aprobación', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion({ tipo: 'afirmacion_medica' }), 0);
    expect(d.motivo).toBe('requiere_aprobacion');
  });

  it('nivel de autonomía insuficiente → denegada', async () => {
    const st = await estadoDePolitica((p) => ({ ...p, nivelAutonomia: 1 }));
    const d = evaluarAutorizacion(st, accion(), 0);
    expect(d.motivo).toBe('nivel_autonomia_insuficiente');
  });

  it('presupuesto excedido → denegada', async () => {
    const d = evaluarAutorizacion(await estadoDePolitica(), accion({ costo: 600 }), 500);
    expect(d.motivo).toBe('presupuesto_excedido');
  });

  it('política suspendida → no vigente', async () => {
    const m = montar(new InMemoryEventStore());
    const ctx = ctxFor('orgA');
    await politicaVigente(m, ctx, 'pol-1');
    await m.policies.suspender(ctx, 'pol-1', 'pausa del dueño', attr, now);
    const st = reconstruirPolicy('pol-1', 'orgA', await m.store.readStream(ctx, 'pol:pol-1'));
    expect(evaluarAutorizacion(st, accion(), 0).motivo).toBe('politica_no_vigente');
  });
});
