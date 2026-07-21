import { describe, expect, it } from 'vitest';
import { ComandoEceInvalidoError } from '../src/domain/errors';
import { elementosPorTipo } from '../src/domain/ece';
import { ambitoMdm, ambitoMed, cmdBase, ctxFor, entorno, vigencia } from './helpers';

async function med1mdm1(e: ReturnType<typeof entorno>, ctx = ctxFor('orgA')) {
  await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'oferta activa', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
  await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  await e.mdm.emitirAfirmacion(ctx, { instanceId: 'w1', afirmacionId: 'b1', enunciado: 'norma vigente', dimension: 'normativo', incertidumbre: 'alta', ...cmdBase });
  return ctx;
}

const construir = { medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase };

describe('EceBuildService — construcción derivada', () => {
  it('integra MED y MDM produciendo elementos derivados (ausencias)', async () => {
    const e = entorno();
    const ctx = await med1mdm1(e);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    const st = await e.query.estadoActual(ctx, 'ece1');
    expect(st.existe).toBe(true);
    expect(st.medCorte?.instanceId).toBe('m1');
    expect(st.mdmCorte?.instanceId).toBe('w1');
    // Ambas afirmaciones pendientes sin evidencia → dos ausencias no evaluables.
    expect(elementosPorTipo(st, 'ausencia')).toHaveLength(2);
  });

  it('exige que MED y MDM existan', async () => {
    const e = entorno();
    const ctx = ctxFor('orgA');
    await expect(e.build.construir(ctx, { eceId: 'ece1', ...construir })).rejects.toBeInstanceOf(ComandoEceInvalidoError);
  });

  it('no modifica MED ni MDM', async () => {
    const e = entorno();
    const ctx = await med1mdm1(e);
    const medAntes = (await e.med.estadoActual(ctx, 'm1')).version;
    const mdmAntes = (await e.mdm.estadoActual(ctx, 'w1')).version;
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    expect((await e.med.estadoActual(ctx, 'm1')).version).toBe(medAntes);
    expect((await e.mdm.estadoActual(ctx, 'w1')).version).toBe(mdmAntes);
  });

  it('es idempotente con clave y reproducible (misma entrada → mismos derivados)', async () => {
    const e = entorno();
    const ctx = await med1mdm1(e);
    await e.build.construir(ctx, { eceId: 'ece1', idempotencyKey: 'k1', ...construir });
    await e.build.construir(ctx, { eceId: 'ece1', idempotencyKey: 'k1', ...construir }); // repetición
    const st = await e.query.estadoActual(ctx, 'ece1');
    expect(st.version).toBe(1); // sin duplicar
    expect(elementosPorTipo(st, 'ausencia')).toHaveLength(2);
  });

  it('reconstruir reemplaza los derivados y conserva los registrados', async () => {
    const e = entorno();
    const ctx = await med1mdm1(e);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    await e.build.registrarElemento(ctx, {
      eceId: 'ece1',
      tipo: 'brecha',
      id: 'reg:brecha:1',
      referencias: [{ modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' }],
      procedencia: 'declarada',
      alcance: 'hace',
      incertidumbre: 'media',
      ...cmdBase,
    });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir }); // reconstruido
    const st = await e.query.estadoActual(ctx, 'ece1');
    expect(elementosPorTipo(st, 'brecha')).toHaveLength(1); // registrado conservado
    expect(st.elementos['reg:brecha:1']?.origen).toBe('registrado');
  });

  it('aísla por organización (otra org no ve el MED/MDM referenciado)', async () => {
    const e = entorno();
    await med1mdm1(e);
    await expect(e.build.construir(ctxFor('orgB'), { eceId: 'ece1', ...construir })).rejects.toBeInstanceOf(
      ComandoEceInvalidoError,
    );
  });
});
