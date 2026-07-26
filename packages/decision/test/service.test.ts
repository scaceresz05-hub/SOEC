/**
 * Servicio: aceptación → vigente; rechazo NO altera el vigente; superación explícita
 * sin resurrección histórica; revocación solo del vigente; concurrencia optimista;
 * idempotencia; autorización; aislamiento.
 */
import { describe, it, expect } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { AutorizacionDenegadaError, DecisionInvalidaError } from '../src/index';
import { attr, ctxFor, montar, now, propuestaReal } from './helpers';

const DEP = 'marketing';
const just = (texto: string) => ({ texto, categoria: 'NEGOCIO' as const });

async function conAceptado() {
  const { svc, store } = montar();
  const ctx = ctxFor('orgA');
  const { snapshot, candidato } = propuestaReal();
  const st = await svc.registrar(
    ctx,
    DEP,
    {
      decisionId: 'd1',
      resultado: 'ACEPTADO',
      candidatoElegido: candidato,
      propuesta: snapshot,
      justificacion: just('atiende el cuello de botella'),
    },
    attr,
    now,
  );
  return { svc, store, ctx, st, candidato };
}

describe('@soec/decision · servicio', () => {
  it('ACEPTADO → vigente con instantánea completa + huella e integridad', async () => {
    const { st, candidato } = await conAceptado();
    expect(st.vigente?.candidato.objetivoId).toBe(candidato.objetivoId);
    const d = st.decisiones[0]!;
    expect(d.estadoRegistro).toBe('VIGENTE');
    expect(d.actor).toBe('director');
    expect(d.snapshotSchemaVersion).toBe(1);
    expect(d.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.propuesta.rubroHuella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('RECHAZADO NO altera el objetivo vigente existente', async () => {
    const { svc, ctx, candidato } = await conAceptado();
    const { snapshot } = propuestaReal();
    const st = await svc.registrar(
      ctx,
      DEP,
      {
        decisionId: 'd2',
        resultado: 'RECHAZADO',
        candidatoElegido: null,
        propuesta: snapshot,
        justificacion: { texto: 'ninguno nuevo conviene', categoria: 'PRIORIDAD' },
      },
      attr,
      now,
    );
    expect(st.vigente?.candidato.objetivoId).toBe(candidato.objetivoId); // sigue A
    expect(st.decisiones[1]!.estadoRegistro).toBe('RECHAZADA');
    expect(st.decisiones[1]!.rechazo?.alcance).toBe('PROPUESTA_COMPLETA');
  });

  it('superación explícita, y revocación sin resurrección histórica', async () => {
    const { svc, ctx } = await conAceptado(); // d1 = A vigente
    const b = propuestaReal();
    let st = await svc.registrar(
      ctx,
      DEP,
      {
        decisionId: 'd2',
        resultado: 'ACEPTADO',
        candidatoElegido: b.candidato,
        propuesta: b.snapshot,
        justificacion: just('ajuste a B'),
        reemplazaDecisionId: 'd1',
      },
      attr,
      now,
    );
    expect(st.vigente?.decisionId).toBe('d2');
    expect(st.decisiones.find((x) => x.decisionId === 'd1')!.estadoRegistro).toBe('SUPERADA');
    // Revocar la vigente (d2) NO resucita d1.
    st = await svc.revocar(ctx, DEP, 'd2', 'cambio de prioridad', attr, now);
    expect(st.vigente).toBeNull();
    expect(st.decisiones.find((x) => x.decisionId === 'd1')!.estadoRegistro).toBe('SUPERADA');
    expect(st.decisiones.find((x) => x.decisionId === 'd2')!.estadoRegistro).toBe('REVOCADA');
  });

  it('una aceptación con vigente exige reemplazo explícito correcto', async () => {
    const { svc, ctx } = await conAceptado();
    const b = propuestaReal();
    await expect(
      svc.registrar(
        ctx,
        DEP,
        {
          decisionId: 'd2',
          resultado: 'ACEPTADO',
          candidatoElegido: b.candidato,
          propuesta: b.snapshot,
          justificacion: just('sin reemplazo'),
        },
        attr,
        now,
      ),
    ).rejects.toBeInstanceOf(DecisionInvalidaError);
  });

  it('no se puede revocar una decisión que no es la vigente', async () => {
    const { svc, ctx } = await conAceptado(); // d1 vigente
    const b = propuestaReal();
    await svc.registrar(
      ctx,
      DEP,
      {
        decisionId: 'd2',
        resultado: 'ACEPTADO',
        candidatoElegido: b.candidato,
        propuesta: b.snapshot,
        justificacion: just('B'),
        reemplazaDecisionId: 'd1',
      },
      attr,
      now,
    );
    await expect(
      svc.revocar(ctx, DEP, 'd1', 'intento sobre superada', attr, now),
    ).rejects.toBeInstanceOf(DecisionInvalidaError);
  });

  it('autorización: un actor sin rol no puede decidir', async () => {
    const { svc } = montar();
    const { snapshot, candidato } = propuestaReal();
    await expect(
      svc.registrar(
        ctxFor('orgA', false),
        DEP,
        {
          decisionId: 'd1',
          resultado: 'ACEPTADO',
          candidatoElegido: candidato,
          propuesta: snapshot,
          justificacion: just('x'),
        },
        attr,
        now,
      ),
    ).rejects.toBeInstanceOf(AutorizacionDenegadaError);
  });

  it('justificación obligatoria', async () => {
    const { svc } = montar();
    const { snapshot, candidato } = propuestaReal();
    await expect(
      svc.registrar(
        ctxFor('orgA'),
        DEP,
        {
          decisionId: 'd1',
          resultado: 'ACEPTADO',
          candidatoElegido: candidato,
          propuesta: snapshot,
          justificacion: just(''),
        },
        attr,
        now,
      ),
    ).rejects.toBeInstanceOf(DecisionInvalidaError);
  });

  it('idempotencia por decisionId, incluso con versión avanzada', async () => {
    const { svc, ctx, candidato } = await conAceptado();
    const p2 = propuestaReal();
    await svc.registrar(
      ctx,
      DEP,
      {
        decisionId: 'd2',
        resultado: 'RECHAZADO',
        candidatoElegido: null,
        propuesta: p2.snapshot,
        justificacion: { texto: 'no', categoria: 'PRIORIDAD' },
      },
      attr,
      now,
    );
    const p = propuestaReal();
    const st = await svc.registrar(
      ctx,
      DEP,
      {
        decisionId: 'd1',
        resultado: 'ACEPTADO',
        candidatoElegido: candidato,
        propuesta: p.snapshot,
        justificacion: just('reintento'),
      },
      attr,
      now,
    );
    expect(st.decisiones).toHaveLength(2); // sin tercer evento
  });

  it('concurrencia optimista: dos aceptaciones sobre la misma versión → una gana, una conflicto', async () => {
    const { svc } = montar();
    const ctx = ctxFor('orgA');
    const a = propuestaReal();
    const b = propuestaReal();
    const r = await Promise.allSettled([
      svc.registrar(
        ctx,
        DEP,
        {
          decisionId: 'dA',
          resultado: 'ACEPTADO',
          candidatoElegido: a.candidato,
          propuesta: a.snapshot,
          justificacion: just('a'),
        },
        attr,
        now,
      ),
      svc.registrar(
        ctx,
        DEP,
        {
          decisionId: 'dB',
          resultado: 'ACEPTADO',
          candidatoElegido: b.candidato,
          propuesta: b.snapshot,
          justificacion: just('b'),
        },
        attr,
        now,
      ),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazado = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazado.reason).toBeInstanceOf(ConcurrencyError);
    const st = await svc.cargar(ctx, DEP);
    expect(st.decisiones).toHaveLength(1); // exactamente un vigente tras el conflicto
    expect(st.vigente).not.toBeNull();
  });

  it('aislamiento multiempresa', async () => {
    const { svc } = await conAceptado();
    const otra = await svc.cargar(ctxFor('orgB'), DEP);
    expect(otra.existe).toBe(false);
    expect(otra.vigente).toBeNull();
  });
});
