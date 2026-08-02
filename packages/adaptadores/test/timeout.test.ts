/**
 * @soec/adaptadores · M4-C-A-H · timeout wall-clock opt-in (C-7). Precedencia determinista y descarte de
 * respuestas tardías, con `programador` inyectado para no depender del reloj real.
 */
import { describe, expect, it } from 'vitest';
import { type Programador, Sandbox, carreraConTimeout } from '../src/index';
import { O, cap, ctx, solicitud } from './helpers';

const disparaYa: Programador = (_ms, cb) => {
  cb();
  return () => {};
};
const nuncaDispara: Programador = () => () => {};
const pausa = () => new Promise<never>(() => {}); // nunca resuelve

describe('@soec/adaptadores · carreraConTimeout (C-7)', () => {
  it('deshabilitado → espera la respuesta (OK)', async () => {
    const r = await carreraConTimeout(async () => 42, { habilitado: false, timeoutMs: 0 }, undefined, nuncaDispara);
    expect(r).toEqual({ tipo: 'OK', valor: 42 });
  });

  it('adaptador que nunca resuelve + timer → TIMEOUT', async () => {
    const r = await carreraConTimeout(() => pausa(), { habilitado: true, timeoutMs: 10 }, undefined, disparaYa);
    expect(r.tipo).toBe('TIMEOUT');
  });

  it('respuesta después del timeout → TIMEOUT permanece (tardía descartada)', async () => {
    const r = await carreraConTimeout(async () => 'tarde', { habilitado: true, timeoutMs: 10 }, undefined, disparaYa);
    expect(r.tipo).toBe('TIMEOUT');
  });

  it('respuesta antes del timeout → OK', async () => {
    const r = await carreraConTimeout(async () => 'pronto', { habilitado: true, timeoutMs: 10 }, undefined, nuncaDispara);
    expect(r).toEqual({ tipo: 'OK', valor: 'pronto' });
  });

  it('señal ya abortada → CANCELADO (precede al timeout)', async () => {
    const c = new AbortController();
    c.abort('cancel');
    const r = await carreraConTimeout(async () => 1, { habilitado: true, timeoutMs: 10 }, c.signal, disparaYa);
    expect(r.tipo).toBe('CANCELADO');
  });

  it('excepción del adaptador → ERROR', async () => {
    const r = await carreraConTimeout(async () => { throw new Error('x'); }, { habilitado: false, timeoutMs: 0 }, undefined, nuncaDispara);
    expect(r.tipo).toBe('ERROR');
  });
});

describe('@soec/adaptadores · Sandbox con timeout opt-in', () => {
  const sb = new Sandbox();
  const nuncaResuelve = {
    nombre: 'lento', capacidad: 'generacion', version: '1.0.0',
    async salud() { return { estado: 'SALUDABLE' as const, detalle: '' }; },
    ejecutar: () => pausa(),
  };

  it('adaptador que nunca resuelve + timeout habilitado → resultado TIMEOUT', async () => {
    const { resultado } = await sb.ejecutar(nuncaResuelve, ctx(), solicitud(), cap(), O, {
      timeout: { habilitado: true, timeoutMs: 10 },
      programador: disparaYa,
    });
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('TIMEOUT');
  });
});
