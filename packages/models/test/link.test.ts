import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ModelLinkService } from '../src/app/link-service';
import { ComandoInvalidoError, ModelAlreadyExistsError } from '../src/domain/errors';
import { attr, ctxFor, vigencia } from './helpers';

const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

describe('Enlace MED↔MDM — explícito, tipado, atribuido (§8)', () => {
  it('registra un enlace conservando origen, naturaleza, atribución, vigencia e incertidumbre', async () => {
    const store = new InMemoryEventStore();
    const links = new ModelLinkService(store);
    const ctx = ctxFor('orgA');
    await links.registrar(ctx, {
      linkId: 'l1',
      medRef: 'med1#u1',
      mdmRef: 'mdm1#norma',
      naturaleza: 'la unidad responde a la norma',
      vigencia,
      incertidumbre: 'media',
      ...base,
    });
    const st = await links.estado(ctx, 'l1');
    expect(st.existe).toBe(true);
    expect(st.medRef).toBe('med1#u1');
    expect(st.mdmRef).toBe('mdm1#norma');
    expect(st.atribucion?.source).toBe('fixture-sintetico');
    expect(st.historial).toHaveLength(1);
  });

  it('exige referencias a ambas representaciones', async () => {
    const store = new InMemoryEventStore();
    const links = new ModelLinkService(store);
    const ctx = ctxFor('orgA');
    await expect(
      links.registrar(ctx, { linkId: 'l1', medRef: '', mdmRef: 'mdm1', naturaleza: 'x', vigencia, incertidumbre: 'baja', ...base }),
    ).rejects.toBeInstanceOf(ComandoInvalidoError);
  });

  it('no registra dos veces el mismo enlace y conserva el historial al revisar', async () => {
    const store = new InMemoryEventStore();
    const links = new ModelLinkService(store);
    const ctx = ctxFor('orgA');
    const cmd = { linkId: 'l1', medRef: 'a', mdmRef: 'b', naturaleza: 'n1', vigencia, incertidumbre: 'media', ...base };
    await links.registrar(ctx, cmd);
    await expect(links.registrar(ctx, cmd)).rejects.toBeInstanceOf(ModelAlreadyExistsError);
    await links.revisar(ctx, { linkId: 'l1', naturaleza: 'n2', motivo: 'cambió el vínculo', ...base });
    const st = await links.estado(ctx, 'l1');
    expect(st.naturaleza).toBe('n2');
    expect(st.historial).toHaveLength(2);
    expect(st.historial[0]?.naturaleza).toBe('n1'); // la historia no se sobrescribe
  });
});
