import { describe, expect, it } from 'vitest';
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { MdmService } from '../src/app/services';
import { ambitoMdm, attr, ctxFor, vigencia } from './helpers';

function setup() {
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const store = new InMemoryEventStore(clock);
  return { store, clock, mdm: new MdmService(store) };
}

const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

describe('MDM — vertical de dominio (diferencias del mundo)', () => {
  it('registra una observación externa atribuida (acceso mediado, #11 dif. 2)', async () => {
    const { mdm } = setup();
    const ctx = ctxFor('orgA');
    await mdm.crear(ctx, { instanceId: 'mdm1', ambito: ambitoMdm, vigencia, ...base });
    await mdm.registrarEntidad(ctx, { instanceId: 'mdm1', entidadId: 'ext1', dimension: 'actores-externos', tipo: 'competidor', atributos: {}, ...base });
    await mdm.registrarObservacion(ctx, { instanceId: 'mdm1', observacionId: 'o1', entidadId: 'ext1', contenido: 'el precio del insumo subió', ...base });
    const st = await mdm.estadoActual(ctx, 'mdm1');
    expect(st.observaciones).toHaveLength(1);
    expect(st.observaciones[0]?.entidadId).toBe('ext1');
    expect(st.observaciones[0]?.atribucion.source).toBe('fixture-sintetico');
  });

  it('emite una afirmación provisional sobre el mundo y la revisa por evidencia posterior', async () => {
    const { mdm } = setup();
    const ctx = ctxFor('orgA');
    await mdm.crear(ctx, { instanceId: 'mdm1', ambito: ambitoMdm, vigencia, ...base });
    await mdm.emitirAfirmacion(ctx, { instanceId: 'mdm1', afirmacionId: 'w1', enunciado: 'la norma N rige desde enero', dimension: 'normativo', incertidumbre: 'alta', ...base });
    let st = await mdm.estadoActual(ctx, 'mdm1');
    expect(st.afirmaciones['w1']?.estado).toBe('pendiente');
    expect(st.afirmaciones['w1']?.incertidumbre).toBe('alta'); // el mundo tensiona más la incertidumbre

    await mdm.incorporarEvidencia(ctx, { instanceId: 'mdm1', evidenciaId: 'e1', afirmacionId: 'w1', relacion: 'sostiene', procedencia: 'diario oficial', contenido: 'publicación', ...base });
    await mdm.revisarAfirmacion(ctx, { instanceId: 'mdm1', afirmacionId: 'w1', nuevoEstado: 'respaldada', motivo: 'confirmada por fuente oficial', ...base });
    st = await mdm.estadoActual(ctx, 'mdm1');
    expect(st.afirmaciones['w1']?.estado).toBe('respaldada');
  });

  it('registra un cambio autónomo del mundo (dif. 3, cambio no informado)', async () => {
    const { mdm } = setup();
    const ctx = ctxFor('orgA');
    await mdm.crear(ctx, { instanceId: 'mdm1', ambito: ambitoMdm, vigencia, ...base });
    await mdm.registrarCambioExterno(ctx, { instanceId: 'mdm1', cambioId: 'c1', descripcion: 'nuevo competidor entró al mercado', ...base });
    const st = await mdm.estadoActual(ctx, 'mdm1');
    expect(st.cambiosExternos).toHaveLength(1);
    expect(st.cambiosExternos[0]?.descripcion).toContain('competidor');
  });

  it('reconstruye el estado del mundo a una fecha anterior', async () => {
    const { mdm, clock } = setup();
    const ctx = ctxFor('orgA');
    await mdm.crear(ctx, { instanceId: 'mdm1', ambito: ambitoMdm, vigencia, ...base });
    await mdm.registrarObservacion(ctx, { instanceId: 'mdm1', observacionId: 'o1', contenido: 'obs 1', ...base });
    clock.advance(1000);
    const corte = clock.now();
    clock.advance(1000);
    await mdm.registrarObservacion(ctx, { instanceId: 'mdm1', observacionId: 'o2', contenido: 'obs 2', ...base });

    const pasado = await mdm.estadoHistorico(ctx, 'mdm1', corte);
    expect(pasado.observaciones).toHaveLength(1);
    const presente = await mdm.estadoActual(ctx, 'mdm1');
    expect(presente.observaciones).toHaveLength(2);
  });
});
