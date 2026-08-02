/**
 * @soec/adaptadores · M4-C-A · adaptadores fake y grabado (deterministas). Estructura de respuesta,
 * fallos normalizados, salud, cancelación y evidencia por clave.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { AdaptadorFake, AdaptadorGrabado, claveEvidencia, errorNormalizado } from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (): RequestContext => {
  const o = OrganizationId('org-a');
  return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 't' };
};

describe('@soec/adaptadores · AdaptadorFake', () => {
  it('responde OK con la salida configurada por operación', async () => {
    const fake = new AdaptadorFake({ capacidad: 'generacion', respuestas: { generar: { titulo: 'Hola' } } });
    const r = await fake.ejecutar(ctx(), { operacion: 'generar', parametros: {} }, O);
    expect(r.estado).toBe('OK');
    expect(r.salida).toEqual({ titulo: 'Hola' });
    expect(r.modo).toBe('SIMULADO');
    expect(r.observadoEn).toBe(O);
  });

  it('operación no soportada → INVALIDO', async () => {
    const fake = new AdaptadorFake({ respuestas: {} });
    const r = await fake.ejecutar(ctx(), { operacion: 'x', parametros: {} }, O);
    expect(r.estado).toBe('ERROR');
    expect(r.error?.clase).toBe('INVALIDO');
  });

  it('errorForzado se devuelve normalizado', async () => {
    const fake = new AdaptadorFake({ errorForzado: errorNormalizado('LIMITE', 'cuota') });
    const r = await fake.ejecutar(ctx(), { operacion: 'generar', parametros: {} }, O);
    expect(r.error?.clase).toBe('LIMITE');
    expect(r.error?.reintentable).toBe(true);
  });

  it('respeta cancelación (AbortSignal) → CANCELADO / TIMEOUT según razón', async () => {
    const fake = new AdaptadorFake({ respuestas: { generar: {} } });
    const c1 = new AbortController();
    c1.abort('cancel');
    expect((await fake.ejecutar(ctx(), { operacion: 'generar', parametros: {} }, O, c1.signal)).error?.clase).toBe('CANCELADO');
    const c2 = new AbortController();
    c2.abort('timeout');
    expect((await fake.ejecutar(ctx(), { operacion: 'generar', parametros: {} }, O, c2.signal)).error?.clase).toBe('TIMEOUT');
  });

  it('salud reporta el estado configurado con el instante inyectado', async () => {
    const fake = new AdaptadorFake({ salud: 'DEGRADADO' });
    expect(await fake.salud(ctx(), O)).toEqual({ estado: 'DEGRADADO', detalle: 'fake', observadoEn: O });
  });
});

describe('@soec/adaptadores · AdaptadorGrabado', () => {
  it('reproduce por clave determinista de la petición', async () => {
    const peticion = { operacion: 'consultar', parametros: { rut: '11', tipo: 'A' } };
    const clave = claveEvidencia(peticion);
    const grabado = new AdaptadorGrabado({ [clave]: { ok: 'sí' } });
    const r = await grabado.ejecutar(ctx(), peticion, O);
    expect(r.estado).toBe('OK');
    expect(r.salida).toEqual({ ok: 'sí' });
    // Clave estable: los parámetros se ordenan.
    expect(clave).toBe('consultar(rut=11&tipo=A)');
  });

  it('sin grabación → NO_DISPONIBLE', async () => {
    const grabado = new AdaptadorGrabado({});
    const r = await grabado.ejecutar(ctx(), { operacion: 'consultar', parametros: {} }, O);
    expect(r.error?.clase).toBe('NO_DISPONIBLE');
  });
});
