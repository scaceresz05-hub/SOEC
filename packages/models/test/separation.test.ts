import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { MedService, MdmService, ModelRepository } from '../src/app/services';
import { ModelSeparationError } from '../src/domain/errors';
import { ambitoMed, ambitoMdm, attr, ctxFor, vigencia } from './helpers';

const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

describe('Frontera MED ╪ MDM — separación verificable (§8)', () => {
  it('un modelo rechaza procesar un evento del otro', async () => {
    const store = new InMemoryEventStore();
    const repo = new ModelRepository(store);
    const ctx = ctxFor('orgA');
    // Intentar emitir un evento MDM a través del repositorio como si fuera MED.
    await expect(
      repo.emitir(ctx, 'MED', 'med1', 0, {
        type: 'mdm.observacion_registrada',
        payload: {},
        attribution: attr,
        occurredAt: base.occurredAt,
      }),
    ).rejects.toBeInstanceOf(ModelSeparationError);
  });

  it('una observación externa (MDM) no modifica el MED', async () => {
    const store = new InMemoryEventStore();
    const med = new MedService(store);
    const mdm = new MdmService(store);
    const ctx = ctxFor('orgA');

    await med.crear(ctx, { instanceId: 'x', ambito: ambitoMed, vigencia, ...base });
    await med.registrarEntidad(ctx, { instanceId: 'x', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });
    const medAntes = await med.estadoActual(ctx, 'x');

    await mdm.crear(ctx, { instanceId: 'x', ambito: ambitoMdm, vigencia, ...base });
    await mdm.registrarObservacion(ctx, { instanceId: 'x', observacionId: 'o1', contenido: 'cambio del entorno', ...base });

    const medDespues = await med.estadoActual(ctx, 'x');
    // Mismo instanceId, pero streams y estados independientes: el MED no cambió.
    expect(medDespues.version).toBe(medAntes.version);
    expect(medDespues.observaciones).toHaveLength(0);
    const mdmEstado = await mdm.estadoActual(ctx, 'x');
    expect(mdmEstado.observaciones).toHaveLength(1);
    expect(mdmEstado.entidades).toEqual({}); // no heredó la entidad del MED
  });

  it('cargar un agregado solo ve eventos de su propio modelo', async () => {
    const store = new InMemoryEventStore();
    const med = new MedService(store);
    const mdm = new MdmService(store);
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'x', ambito: ambitoMed, vigencia, ...base });
    await mdm.crear(ctx, { instanceId: 'x', ambito: ambitoMdm, vigencia, ...base });
    const medEstado = await med.estadoActual(ctx, 'x');
    const mdmEstado = await mdm.estadoActual(ctx, 'x');
    expect(medEstado.modelType).toBe('MED');
    expect(mdmEstado.modelType).toBe('MDM');
    expect(medEstado.version).toBe(1);
    expect(mdmEstado.version).toBe(1);
  });
});
