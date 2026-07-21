import { describe, expect, it } from 'vitest';
import { elementosPorTipo } from '../src/domain/ece';
import { ambitoMdm, ambitoMed, cmdBase, ctxFor, entorno, vigencia } from './helpers';

const construir = { medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase };

async function baseMedMdm(e: ReturnType<typeof entorno>, ctx = ctxFor('orgA')) {
  await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  return ctx;
}

describe('Escenarios sintéticos del ECE (§22)', () => {
  it('A — Coherencia: MED respaldado + MDM compatible; conserva procedencia y limitaciones', async () => {
    const e = entorno();
    const ctx = await baseMedMdm(e);
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'la oferta opera', dimension: 'hace', incertidumbre: 'baja', limitacion: 'solo turno diurno', ...cmdBase });
    await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'e1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'bitácora', contenido: 'ok', ...cmdBase });
    await e.med.revisarAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'evidencia', ...cmdBase });
    await e.mdm.registrarObservacion(ctx, { instanceId: 'w1', observacionId: 'o1', contenido: 'demanda compatible', ...cmdBase });

    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    const coh = await e.query.coherencias(ctx, 'ece1');
    expect(coh).toHaveLength(1);
    expect(coh[0]?.procedencia).toContain('MED:m1');
    expect(coh[0]?.limitaciones).toContain('solo turno diurno');
  });

  it('B — Contradicción MED↔MDM registrada sin decidir cuál prevalece', async () => {
    const e = entorno();
    const ctx = await baseMedMdm(e);
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'la empresa cumple la norma', dimension: 'hace', incertidumbre: 'media', ...cmdBase });
    await e.mdm.emitirAfirmacion(ctx, { instanceId: 'w1', afirmacionId: 'b1', enunciado: 'la norma exige lo contrario', dimension: 'normativo', incertidumbre: 'media', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    await e.build.registrarElemento(ctx, {
      eceId: 'ece1',
      tipo: 'contradiccion',
      id: 'reg:contra:1',
      referencias: [
        { modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' },
        { modelo: 'MDM', instanceId: 'w1', elementoId: 'b1', elementoTipo: 'afirmacion' },
      ],
      procedencia: 'correspondencia declarada MED↔MDM',
      alcance: 'cumplimiento normativo',
      incertidumbre: 'media',
      ...cmdBase,
    });
    const contra = await e.query.contradicciones(ctx, 'ece1');
    expect(contra).toHaveLength(1);
    // El ECE registra la contradicción; no marca ningún lado como prevalente.
    expect(contra[0]?.referencias).toHaveLength(2);
    expect(contra[0]?.estadoRevision).toBe('vigente');
  });

  it('C — Ausencia: afirmación sin evidencia queda no evaluable', async () => {
    const e = entorno();
    const ctx = await baseMedMdm(e);
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'requiere dato ausente', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    const aus = await e.query.ausencias(ctx, 'ece1');
    const noEval = await e.query.noEvaluables(ctx, 'ece1');
    expect(aus.length).toBeGreaterThanOrEqual(1);
    expect(noEval.some((x) => x.tipo === 'ausencia')).toBe(true);
  });

  it('D — Dependencia insatisfecha → satisfecha en versión histórica posterior', async () => {
    const e = entorno();
    const ctx = await baseMedMdm(e);
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'evaluación pendiente', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    await e.build.registrarElemento(ctx, {
      eceId: 'ece1',
      tipo: 'dependencia',
      id: 'dep:1',
      referencias: [
        { modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' },
        { modelo: 'MDM', instanceId: 'w1', elementoId: null, elementoTipo: 'observacion' },
      ],
      procedencia: 'depende de una observación externa',
      alcance: 'evaluación',
      incertidumbre: 'alta',
      estadoSatisfaccion: 'insatisfecha',
      ...cmdBase,
    });
    e.clock.advance(1000);
    const corte = e.clock.now();
    e.clock.advance(1000);
    await e.build.revisarElemento(ctx, { eceId: 'ece1', elementoId: 'dep:1', estadoRevision: 'revisado', motivo: 'observación disponible', estadoSatisfaccion: 'satisfecha', ...cmdBase });

    const actual = await e.query.dependencias(ctx, 'ece1');
    expect(actual[0]?.estadoSatisfaccion).toBe('satisfecha');
    const pasado = await e.query.estadoEnFecha(ctx, 'ece1', corte);
    expect(pasado.elementos['dep:1']?.estadoSatisfaccion).toBe('insatisfecha'); // no retroyección
  });

  it('E — Brecha registrada, sin proponer acción', async () => {
    const e = entorno();
    const ctx = await baseMedMdm(e);
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'capacidad actual', dimension: 'hace', incertidumbre: 'media', ...cmdBase });
    await e.mdm.emitirAfirmacion(ctx, { instanceId: 'w1', afirmacionId: 'b1', enunciado: 'demanda del mundo', dimension: 'economico', incertidumbre: 'media', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    await e.build.registrarElemento(ctx, {
      eceId: 'ece1',
      tipo: 'brecha',
      id: 'brecha:1',
      referencias: [
        { modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' },
        { modelo: 'MDM', instanceId: 'w1', elementoId: 'b1', elementoTipo: 'afirmacion' },
      ],
      procedencia: 'distancia empresa↔mundo',
      alcance: 'capacidad vs demanda',
      incertidumbre: 'media',
      ...cmdBase,
    });
    const br = await e.query.brechas(ctx, 'ece1');
    expect(br).toHaveLength(1);
    // El elemento de brecha no contiene ninguna acción/recomendación: solo referencias y procedencia.
    expect(Object.keys(br[0] ?? {})).not.toContain('accion');
    expect(Object.keys(br[0] ?? {})).not.toContain('recomendacion');
  });

  it('F — Cambio temporal: el ECE anterior y el posterior son consultables sin contaminación', async () => {
    const e = entorno();
    const ctx = await baseMedMdm(e);
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'afirmación', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir }); // deriva ausencia
    e.clock.advance(1000);
    const corte = e.clock.now();
    e.clock.advance(1000);
    // Nueva evidencia cambia el MED: la afirmación pasa a respaldada.
    await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'e1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'src', contenido: 'c', ...cmdBase });
    await e.med.revisarAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'evidencia nueva', ...cmdBase });
    await e.build.construir(ctx, { eceId: 'ece1', ...construir }); // reconstruido

    const pasado = await e.query.estadoEnFecha(ctx, 'ece1', corte);
    expect(elementosPorTipo(pasado, 'ausencia')).toHaveLength(1);
    expect(elementosPorTipo(pasado, 'coherencia')).toHaveLength(0);
    const actual = await e.query.estadoActual(ctx, 'ece1');
    expect(elementosPorTipo(actual, 'coherencia')).toHaveLength(1);
    expect(elementosPorTipo(actual, 'ausencia')).toHaveLength(0);
  });
});
