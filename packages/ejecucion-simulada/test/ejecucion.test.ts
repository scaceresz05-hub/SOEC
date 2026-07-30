/**
 * Ejecución simulada (Bloque E). Verifica:
 *   - el adaptador determinista mapea cada escenario a un resultado estable;
 *   - la idempotencia impide que una petición duplicada cree dos publicaciones simuladas;
 *   - cada intento deja un registro auditable (simulado + adaptador + requestId + idempotencyKey);
 *   - los fallos temporales son reintentables y los permanentes/rechazos no;
 *   - no se puede ejecutar sobre un contenido de otra organización.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import {
  EjecucionService,
  AdaptadorSimuladoDeterminista,
  SeparacionEjecucionVioladaError,
  resultadoDeEscenario,
  esReintentable,
  type ComandoEjecucion,
  type EscenarioEjecucion,
} from '../src/index';

const now = '2026-07-28T12:00:00.000Z';
const attr: Attribution = { source: 'ejecucion', purpose: 'publicar', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'smileflow';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}

function cmd(over: Partial<ComandoEjecucion> = {}): ComandoEjecucion {
  return { organizacionId: ORG, contenidoId: 'ct1', campaniaId: 'c1', canal: 'correo', idempotencyKey: 'k1', ...over };
}

const montar = (escenario: EscenarioEjecucion = 'SUCCESS') => {
  const store = new InMemoryEventStore();
  return new EjecucionService(store, new AdaptadorSimuladoDeterminista('adaptador-test', escenario));
};

describe('@soec/ejecucion-simulada · adaptador determinista', () => {
  it('mapea cada escenario a un resultado estable', () => {
    expect(resultadoDeEscenario('SUCCESS')).toBe('PUBLICADA_SIMULADA');
    expect(resultadoDeEscenario('TEMPORARY_FAILURE')).toBe('FALLIDA_TEMPORAL');
    expect(resultadoDeEscenario('RATE_LIMITED')).toBe('FALLIDA_TEMPORAL');
    expect(resultadoDeEscenario('PERMANENT_FAILURE')).toBe('FALLIDA_PERMANENTE');
    expect(resultadoDeEscenario('AUTHORIZATION_LOST')).toBe('RECHAZADA');
    expect(resultadoDeEscenario('REJECTED_BY_POLICY')).toBe('RECHAZADA');
    expect(resultadoDeEscenario('BUDGET_EXHAUSTED')).toBe('RECHAZADA');
    expect(resultadoDeEscenario('DUPLICATE_REQUEST')).toBe('DUPLICADA');
  });

  it('solo los fallos transitorios son reintentables', () => {
    expect(esReintentable('TEMPORARY_FAILURE')).toBe(true);
    expect(esReintentable('RATE_LIMITED')).toBe(true);
    expect(esReintentable('PERMANENT_FAILURE')).toBe(false);
    expect(esReintentable('REJECTED_BY_POLICY')).toBe(false);
  });

  it('el mismo escenario produce el mismo resultado (determinista)', async () => {
    const svc = montar('SUCCESS');
    const r1 = await svc.ejecutar(ctx(), cmd({ idempotencyKey: 'a' }), attr, now);
    const r2 = await svc.ejecutar(ctx(), cmd({ idempotencyKey: 'b' }), attr, now);
    expect(r1.registro.resultado).toBe('PUBLICADA_SIMULADA');
    expect(r2.registro.resultado).toBe('PUBLICADA_SIMULADA');
  });
});

describe('@soec/ejecucion-simulada · registro auditable', () => {
  it('cada intento registra simulado + adaptador + requestId + idempotencyKey + escenario', async () => {
    const svc = montar('SUCCESS');
    const { registro } = await svc.ejecutar(ctx(), cmd(), attr, now);
    expect(registro.simulado).toBe(true);
    expect(registro.adaptador).toBe('adaptador-test');
    expect(registro.requestId).toContain('req:');
    expect(registro.idempotencyKey).toBe('k1');
    expect(registro.escenario).toBe('SUCCESS');
    expect(registro.intento).toBe(1);
  });
});

describe('@soec/ejecucion-simulada · idempotencia', () => {
  it('una petición duplicada NO crea una segunda publicación simulada', async () => {
    const svc = montar('SUCCESS');
    const primera = await svc.ejecutar(ctx(), cmd({ idempotencyKey: 'k1' }), attr, now);
    expect(primera.registro.resultado).toBe('PUBLICADA_SIMULADA');
    expect(primera.estado.publicacionesSimuladas).toBe(1);

    const segunda = await svc.ejecutar(ctx(), cmd({ idempotencyKey: 'k1' }), attr, now);
    expect(segunda.duplicada).toBe(true);
    expect(segunda.registro.resultado).toBe('DUPLICADA');
    // La invariante clave: sigue habiendo UNA sola publicación simulada.
    expect(segunda.estado.publicacionesSimuladas).toBe(1);
    // Pero la petición duplicada sí queda auditada.
    expect(segunda.estado.registros).toHaveLength(2);
  });

  it('claves de idempotencia distintas sí generan publicaciones distintas', async () => {
    const svc = montar('SUCCESS');
    await svc.ejecutar(ctx(), cmd({ idempotencyKey: 'k1' }), attr, now);
    const otra = await svc.ejecutar(ctx(), cmd({ idempotencyKey: 'k2' }), attr, now);
    expect(otra.estado.publicacionesSimuladas).toBe(2);
  });
});

describe('@soec/ejecucion-simulada · separación', () => {
  it('rechaza ejecutar sobre un contenido de otra organización', async () => {
    const svc = montar('SUCCESS');
    await expect(svc.ejecutar(ctx(ORG), cmd({ organizacionId: 'otra-org' }), attr, now)).rejects.toBeInstanceOf(SeparacionEjecucionVioladaError);
  });
});
