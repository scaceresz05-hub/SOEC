import { describe, expect, it } from 'vitest';
import { ambitoMdm, ambitoMed, cmdBase, ctxFor, entorno, vigencia } from './helpers';

const construir = { medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase };

async function base(e: ReturnType<typeof entorno>, ctx = ctxFor('orgA')) {
  await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  return ctx;
}

describe('ECE — vigencia, invalidación y no retroyección', () => {
  it('un ECE recién construido está vigente', async () => {
    const e = entorno();
    const ctx = await base(e);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    const v = await e.query.vigencia(ctx, 'ece1');
    expect(v.vigente).toBe(true);
    expect(v.requiereReconstruccion).toBe(false);
  });

  it('detecta desactualización cuando el MED avanza más allá del corte', async () => {
    const e = entorno();
    const ctx = await base(e);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    // El MED cambia después de construido el ECE.
    await e.med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...cmdBase });
    const v = await e.query.vigencia(ctx, 'ece1');
    expect(v.requiereReconstruccion).toBe(true);
    expect(v.vigente).toBe(false);
    expect(v.medVersionActual).toBeGreaterThan(v.medCorte?.version ?? 0);
  });

  it('invalidar marca requiere reconstrucción y conserva la versión anterior', async () => {
    const e = entorno();
    const ctx = await base(e);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    e.clock.advance(1000);
    const corte = e.clock.now();
    e.clock.advance(1000);
    await e.build.invalidar(ctx, { eceId: 'ece1', motivo: 'entradas cambiaron', causationId: 'evt-x', ...cmdBase });

    const actual = await e.query.estadoActual(ctx, 'ece1');
    expect(actual.requiereReconstruccion).toBe(true);
    expect(actual.vigente).toBe(false);
    expect(actual.invalidadoPor).toBe('evt-x'); // trazabilidad causal

    const pasado = await e.query.estadoEnFecha(ctx, 'ece1', corte);
    expect(pasado.vigente).toBe(true); // el estado anterior no se sobrescribió
    expect(pasado.requiereReconstruccion).toBe(false);
  });

  it('reconstruir tras invalidación vuelve a dejar el ECE vigente', async () => {
    const e = entorno();
    const ctx = await base(e);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    await e.med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...cmdBase });
    await e.build.invalidar(ctx, { eceId: 'ece1', motivo: 'cambio', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir }); // reconstruido al corte nuevo
    const v = await e.query.vigencia(ctx, 'ece1');
    expect(v.vigente).toBe(true);
    expect(v.requiereReconstruccion).toBe(false);
  });
});
