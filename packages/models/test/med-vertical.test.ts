import { describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { MedService, ModelRepository } from '../src/app/services';
import { ModelAlreadyExistsError, ModelNotFoundError, ReferenteInexistenteError } from '../src/domain/errors';
import { ambitoMed, attr, ctxFor, vigencia } from './helpers';

function setup() {
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const store = new InMemoryEventStore(clock);
  return { store, clock, med: new MedService(store) };
}

const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

describe('MED — vertical de dominio', () => {
  it('crea una instancia y refleja su ámbito y vigencia', async () => {
    const { med } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    const st = await med.estadoActual(ctx, 'med1');
    expect(st.existe).toBe(true);
    expect(st.modelType).toBe('MED');
    expect(st.ambito?.excluye).toContain('MDM');
  });

  it('rechaza crear dos veces la misma instancia', async () => {
    const { med } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    await expect(
      med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base }),
    ).rejects.toBeInstanceOf(ModelAlreadyExistsError);
  });

  it('rechaza operar sobre una instancia inexistente', async () => {
    const { med } = setup();
    const ctx = ctxFor('orgA');
    await expect(
      med.registrarEntidad(ctx, { instanceId: 'noexiste', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base }),
    ).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  it('actualiza mediante eventos sin sobrescribir la historia', async () => {
    const { med } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    await med.registrarEntidad(ctx, { instanceId: 'med1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: { nombre: 'Operaciones' }, ...base });
    await med.modificarEntidad(ctx, { instanceId: 'med1', entidadId: 'u1', atributos: { turnos: 2 }, ...base });
    const st = await med.estadoActual(ctx, 'med1');
    expect(st.entidades['u1']?.atributos).toEqual({ nombre: 'Operaciones', turnos: 2 });
    expect(st.version).toBe(3);
  });

  it('incorpora evidencia y revisa una afirmación; la evidencia exige afirmación previa', async () => {
    const { med } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    await expect(
      med.incorporarEvidencia(ctx, { instanceId: 'med1', evidenciaId: 'ev1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'registro', contenido: 'c', ...base }),
    ).rejects.toBeInstanceOf(ReferenteInexistenteError);

    await med.emitirAfirmacion(ctx, { instanceId: 'med1', afirmacionId: 'a1', enunciado: 'la unidad ejecuta el proceso P', dimension: 'hace', incertidumbre: 'media', ...base });
    await med.incorporarEvidencia(ctx, { instanceId: 'med1', evidenciaId: 'ev1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'bitácora', contenido: 'observado', ...base });
    await med.revisarAfirmacion(ctx, { instanceId: 'med1', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'evidencia suficiente', ...base });

    const st = await med.estadoActual(ctx, 'med1');
    expect(st.afirmaciones['a1']?.estado).toBe('respaldada');
    expect(st.afirmaciones['a1']?.evidencias).toEqual(['ev1']);
    expect(st.afirmaciones['a1']?.atribucion.source).toBe('fixture-sintetico'); // atribución de primera clase
  });

  it('reconstruye el estado a una fecha anterior sin contaminación posterior', async () => {
    const { med, clock } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    await med.registrarEntidad(ctx, { instanceId: 'med1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });
    const st1 = await med.estadoActual(ctx, 'med1');
    const cutoff = st1.version; // 2 eventos
    clock.advance(1000);
    const corte = clock.now();
    clock.advance(1000);
    await med.registrarEntidad(ctx, { instanceId: 'med1', entidadId: 'u2', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });

    const pasado = await med.estadoHistorico(ctx, 'med1', corte);
    expect(pasado.version).toBe(cutoff);
    expect(Object.keys(pasado.entidades)).toEqual(['u1']);
    const presente = await med.estadoActual(ctx, 'med1');
    expect(Object.keys(presente.entidades).sort()).toEqual(['u1', 'u2']);
  });

  it('respeta la concurrencia optimista (versión esperada obsoleta → conflicto)', async () => {
    const { store, med } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    const repo = new ModelRepository(store);
    await expect(
      repo.emitir(ctx, 'MED', 'med1', 0 /* obsoleta: real es 1 */, {
        type: 'med.entidad_registrada',
        payload: { entidadId: 'x', dimension: 'es', tipo: 'unidad', atributos: {} },
        attribution: attr,
        occurredAt: base.occurredAt,
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('es idempotente cuando se aporta clave (no duplica)', async () => {
    const { med } = setup();
    const ctx = ctxFor('orgA');
    await med.crear(ctx, { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    const cmd = { instanceId: 'med1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, idempotencyKey: 'k-u1', ...base };
    await med.registrarEntidad(ctx, cmd);
    await med.registrarEntidad(ctx, cmd); // repetición
    const st = await med.estadoActual(ctx, 'med1');
    expect(Object.keys(st.entidades)).toEqual(['u1']);
    expect(st.version).toBe(2); // creada + 1 entidad, sin duplicar
  });

  it('aísla por organización: otra organización no ve la instancia', async () => {
    const { med } = setup();
    await med.crear(ctxFor('orgA'), { instanceId: 'med1', ambito: ambitoMed, vigencia, ...base });
    const stB = await med.estadoActual(ctxFor('orgB'), 'med1');
    expect(stB.existe).toBe(false);
  });
});
