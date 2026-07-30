/**
 * Aprendizaje estructurado (Bloque G). Verifica:
 *   - el aprendizaje se estructura en capas separadas (observado / interpretación / conclusión /
 *     reutilizable) y no admite estructura incompleta;
 *   - la capa observada se deriva del experimento de @soec/medicion (integración);
 *   - un aprendizaje de SmileFlow NO puede aplicarse a SSR Control sin decisión humana;
 *   - con decisión humana explícita, la aplicación cruzada queda registrada y trazable;
 *   - aplicarlo dentro de la organización de origen no requiere decisión humana.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { evaluarExperimento, type Experimento } from '@soec/medicion';
import {
  AprendizajeService,
  AprendizajeInvalidoError,
  AplicacionSinDecisionHumanaError,
  observadoDesdeExperimento,
  type EntradaAprendizaje,
} from '../src/index';

const now = '2026-07-29T12:00:00.000Z';
const attr: Attribution = { source: 'aprendizaje', purpose: 'aprender', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'smileflow';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}

const exp: Experimento = {
  experimentoId: 'e1',
  hipotesis: 'la variante con prueba social convierte más',
  metricaPrincipal: 'conversiones',
  control: { actividadId: 'a1', publicationId: 'p1' },
  variante: { actividadId: 'a2', publicationId: 'p2' },
  minimoObservaciones: 100,
  margenMinimo: 0.1,
};

function entrada(): EntradaAprendizaje {
  const resultado = evaluarExperimento(exp, 40, 500, 60, 500); // variante gana, evidencia suficiente
  return {
    observado: observadoDesdeExperimento('e1', resultado, 1000),
    interpretacion: { texto: 'la prueba social parece impulsar la conversión', supuestos: ['audiencia comparable'], confianza: 'media' },
    conclusion: { enunciado: 'usar prueba social en el mensaje principal', soporte: 'evidencia_suficiente', accionRecomendada: 'adoptar la variante' },
    reutilizable: { enunciado: 'la prueba social mejora conversión en clínicas dentales', condiciones: ['audiencia pyme'], ambitoSugerido: ['smileflow'] },
  };
}

const montar = () => new AprendizajeService(new InMemoryEventStore());

describe('@soec/aprendizaje · estructura en capas', () => {
  it('registra las cuatro capas separadas y deriva la observada del experimento', async () => {
    const svc = montar();
    const ap = await svc.registrar(ctx(), 'ap1', entrada(), attr, now);
    expect(ap.existe).toBe(true);
    expect(ap.observado?.experimentoId).toBe('e1');
    expect(ap.observado?.ganador).toBe('variante'); // hecho observado
    expect(ap.interpretacion?.confianza).toBe('media'); // interpretación, no hecho
    expect(ap.conclusion?.soporte).toBe('evidencia_suficiente');
    expect(ap.reutilizable?.enunciado).toContain('prueba social');
  });

  it('rechaza un aprendizaje sin conclusión (estructura incompleta)', async () => {
    const svc = montar();
    const malo = { ...entrada(), conclusion: { enunciado: '', soporte: 'evidencia_insuficiente' as const, accionRecomendada: '' } };
    await expect(svc.registrar(ctx(), 'ap2', malo, attr, now)).rejects.toBeInstanceOf(AprendizajeInvalidoError);
  });
});

describe('@soec/aprendizaje · reutilización entre organizaciones', () => {
  it('un aprendizaje de SmileFlow NO puede aplicarse a SSR Control sin decisión humana', async () => {
    const svc = montar();
    await svc.registrar(ctx(), 'ap1', entrada(), attr, now);
    await expect(svc.aplicarEn(ctx(), 'ap1', 'ssr-control', null, attr, now)).rejects.toBeInstanceOf(AplicacionSinDecisionHumanaError);
  });

  it('con decisión humana explícita, la aplicación cruzada queda registrada y trazable', async () => {
    const svc = montar();
    await svc.registrar(ctx(), 'ap1', entrada(), attr, now);
    const ap = await svc.aplicarEn(
      ctx(),
      'ap1',
      'ssr-control',
      { actorHumano: 'director-humano', decisionId: 'dec-humana-1', justificacion: 'contexto comparable, validado por humano' },
      attr,
      now,
    );
    expect(ap.estado).toBe('APLICADO');
    expect(ap.aplicaciones).toHaveLength(1);
    expect(ap.aplicaciones[0]!.organizacionDestino).toBe('ssr-control');
    expect(ap.aplicaciones[0]!.actorHumano).toBe('director-humano');
    expect(ap.aplicaciones[0]!.decisionId).toBe('dec-humana-1');
  });

  it('aplicarlo dentro de la organización de origen no requiere decisión humana', async () => {
    const svc = montar();
    await svc.registrar(ctx(), 'ap1', entrada(), attr, now);
    const ap = await svc.aplicarEn(ctx(), 'ap1', ORG, null, attr, now);
    expect(ap.estado).toBe('APLICADO');
    expect(ap.aplicaciones[0]!.organizacionDestino).toBe(ORG);
  });
});
