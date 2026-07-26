/**
 * Captura del Director: identidad de evaluación (org+dep+id, sin mezcla entre sesiones),
 * normalización segura, borrador durable/reanudable, corrección, generación congelada,
 * ciclo de estados, índice/listado y versionado de esquema (compatibilidad).
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import {
  ActorId,
  OrganizationId,
  type Attribution,
  type EventInput,
  type RequestContext,
} from '@soec/contracts';
import {
  EsquemaEvaluacionDesconocidoError,
  EvaluacionInvalidaError,
  EvaluacionService,
  aRespuestasDiagnostico,
  evalStreamId,
  generacionVigente,
  normalizarBoolean,
  reconstruirEvaluacion,
} from '../src/index';

const now = '2026-07-24T12:00:00.000Z';
const attr: Attribution = {
  source: 'captura',
  purpose: 'capturar respuestas del Director',
  assumptions: ['sintético'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
const DEP = 'marketing';
const E = 'E1';
function ctxFor(org: string): RequestContext {
  const organizationId = OrganizationId(org);
  return {
    organizationId,
    actor: ActorId('director'),
    scope: { organizationId, permissions: ['events:append', 'events:read'] },
    correlationId: `c-${org}`,
  };
}
const montar = () => {
  const store = new InMemoryEventStore();
  return { store, svc: new EvaluacionService(store) };
};

describe('@soec/evaluacion · normalización segura', () => {
  it('interpreta solo valores inequívocos; lo ambiguo es null', () => {
    expect(normalizarBoolean('sí')).toBe(true);
    expect(normalizarBoolean(' NO ')).toBe(false);
    expect(normalizarBoolean('a veces')).toBeNull();
    expect(normalizarBoolean('depende')).toBeNull();
  });
});

describe('@soec/evaluacion · captura e identidad', () => {
  it('captura cerrada afirmativa y la proyecta con valor true', async () => {
    const { svc } = montar();
    const ctx = ctxFor('orgA');
    await svc.iniciar(ctx, DEP, E, 'clinica-dental', 'Caso', attr, now);
    const st = await svc.responder(
      ctx,
      DEP,
      E,
      {
        preguntaId: 'Q1',
        tipoPregunta: 'CERRADA_BOOLEAN',
        entrada: { clase: 'CERRADA', valorCrudo: 'sí' },
      },
      attr,
      now,
    );
    expect(st.respuestas['Q1']!.valorNormalizado).toBe(true);
    expect(aRespuestasDiagnostico(st)).toContainEqual({
      preguntaId: 'Q1',
      tipo: 'afirmada',
      enunciado: 'Sí',
      sustento: 'respuesta del Director',
      valor: true,
    });
  });

  it('dos evaluaciones del mismo (org,dep) NO mezclan respuestas', async () => {
    const { svc } = montar();
    const ctx = ctxFor('orgA');
    await svc.responder(
      ctx,
      DEP,
      'E1',
      {
        preguntaId: 'Q1',
        tipoPregunta: 'ABIERTA',
        entrada: { clase: 'ABIERTA', texto: 'respuesta de E1' },
      },
      attr,
      now,
    );
    await svc.responder(
      ctx,
      DEP,
      'E2',
      {
        preguntaId: 'Q1',
        tipoPregunta: 'ABIERTA',
        entrada: { clase: 'ABIERTA', texto: 'respuesta de E2' },
      },
      attr,
      now,
    );
    const e1 = await svc.cargar(ctx, DEP, 'E1');
    const e2 = await svc.cargar(ctx, DEP, 'E2');
    expect((e1.respuestas['Q1']!.entrada as { texto: string }).texto).toBe('respuesta de E1');
    expect((e2.respuestas['Q1']!.entrada as { texto: string }).texto).toBe('respuesta de E2');
  });

  it('valor cerrado ambiguo → NO_NORMALIZABLE, entrada original conservada, se OMITE de la proyección', async () => {
    const { svc } = montar();
    const ctx = ctxFor('orgA');
    const st = await svc.responder(
      ctx,
      DEP,
      E,
      {
        preguntaId: 'Q1',
        tipoPregunta: 'CERRADA_BOOLEAN',
        entrada: { clase: 'CERRADA', valorCrudo: 'a veces' },
      },
      attr,
      now,
    );
    expect(st.respuestas['Q1']!.estado).toBe('NO_NORMALIZABLE');
    expect(st.respuestas['Q1']!.entrada).toEqual({ clase: 'CERRADA', valorCrudo: 'a veces' });
    expect(aRespuestasDiagnostico(st).some((r) => r.preguntaId === 'Q1')).toBe(false);
  });

  it('la corrección gobierna y el borrador se reconstruye del stream', async () => {
    const { svc, store } = montar();
    const ctx = ctxFor('orgA');
    await svc.responder(
      ctx,
      DEP,
      E,
      {
        preguntaId: 'Q1',
        tipoPregunta: 'CERRADA_BOOLEAN',
        entrada: { clase: 'CERRADA', valorCrudo: 'no' },
      },
      attr,
      now,
    );
    await svc.responder(
      ctx,
      DEP,
      E,
      {
        preguntaId: 'Q1',
        tipoPregunta: 'CERRADA_BOOLEAN',
        entrada: { clase: 'CERRADA', valorCrudo: 'sí' },
      },
      attr,
      now,
    );
    const eventos = await store.readStream(ctx, evalStreamId('orgA', DEP, E));
    expect(reconstruirEvaluacion('orgA', DEP, E, eventos).respuestas['Q1']!.valorNormalizado).toBe(
      true,
    );
  });
});

describe('@soec/evaluacion · ciclo de estados, índice y generación', () => {
  it('BORRADOR → GENERADA → CERRADA; cerrada no admite más respuestas', async () => {
    const { svc } = montar();
    const ctx = ctxFor('orgA');
    let st = await svc.iniciar(ctx, DEP, E, 'clinica-dental', 'Caso', attr, now);
    expect(st.existe).toBe(true);
    await svc.responder(
      ctx,
      DEP,
      E,
      {
        preguntaId: 'Q1',
        tipoPregunta: 'CERRADA_BOOLEAN',
        entrada: { clase: 'CERRADA', valorCrudo: 'sí' },
      },
      attr,
      now,
    );
    st = await svc.generar(ctx, DEP, E, 'g1', attr, now);
    expect(generacionVigente(st)!.huella).toMatch(/^[0-9a-f]{64}$/);
    await svc.cerrar(ctx, DEP, E, attr, now);
    await expect(
      svc.responder(
        ctx,
        DEP,
        E,
        { preguntaId: 'Q2', tipoPregunta: 'ABIERTA', entrada: { clase: 'ABIERTA', texto: 'x' } },
        attr,
        now,
      ),
    ).rejects.toBeInstanceOf(EvaluacionInvalidaError);
  });

  it('el índice lista las evaluaciones del (org,dep) con su estado', async () => {
    const { svc } = montar();
    const ctx = ctxFor('orgA');
    await svc.iniciar(ctx, DEP, 'E1', 'clinica-dental', 'Uno', attr, now);
    await svc.iniciar(ctx, DEP, 'E2', 'clinica-dental', 'Dos', attr, now);
    await svc.generar(ctx, DEP, 'E2', 'g', attr, now);
    const lista = await svc.listar(ctx, DEP);
    expect(lista.map((l) => l.evaluacionId).sort()).toEqual(['E1', 'E2']);
    expect(lista.find((l) => l.evaluacionId === 'E1')!.estado).toBe('BORRADOR');
    expect(lista.find((l) => l.evaluacionId === 'E2')!.estado).toBe('GENERADA');
  });
});

describe('@soec/evaluacion · versionado de esquema', () => {
  it('un evento con versión futura desconocida hace fallar la reconstrucción', async () => {
    const { svc, store } = montar();
    const ctx = ctxFor('orgA');
    const input: EventInput = {
      type: 'evaluacion.iniciada',
      payload: { rubroId: 'x', schemaVersion: 999 },
      attribution: attr,
      occurredAt: now,
    };
    await store.append(ctx, evalStreamId('orgA', DEP, E), 0, [input]);
    await expect(svc.cargar(ctx, DEP, E)).rejects.toBeInstanceOf(EsquemaEvaluacionDesconocidoError);
  });

  it('un evento sin schemaVersion se interpreta como versión inicial (compatibilidad dev)', async () => {
    const { store } = montar();
    const ctx = ctxFor('orgA');
    const input: EventInput = {
      type: 'evaluacion.iniciada',
      payload: { rubroId: 'clinica-dental' },
      attribution: attr,
      occurredAt: now,
    };
    await store.append(ctx, evalStreamId('orgA', DEP, E), 0, [input]);
    const st = reconstruirEvaluacion(
      'orgA',
      DEP,
      E,
      await store.readStream(ctx, evalStreamId('orgA', DEP, E)),
    );
    expect(st.existe).toBe(true);
    expect(st.rubroId).toBe('clinica-dental');
  });
});
