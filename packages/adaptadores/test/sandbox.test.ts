/**
 * @soec/adaptadores · M4-C-A-H · sandbox AUTORITATIVO. El adaptador no puede ser autoridad sobre identidad,
 * tenant, modo, naturaleza ni instante; el sandbox los fija y valida. Cancelación pre/post-await, coherencia
 * estructural de salida, inmutabilidad del resultado y la evidencia.
 */
import { describe, expect, it } from 'vitest';
import {
  type AdaptadorExterno,
  type SalidaAdaptador,
  type SolicitudAdaptador,
  Sandbox,
  estadoInicialAdaptador,
} from '../src/index';
import { O, cap, ctx, frontHabilitado, solicitud } from './helpers';

const sb = new Sandbox();

/** Adaptador de prueba que devuelve una SalidaAdaptador fija (posible junk extra a nivel runtime). */
const adaptador = (salida: SalidaAdaptador, extra: Record<string, unknown> = {}): AdaptadorExterno => ({
  nombre: 'fake',
  capacidad: 'generacion',
  version: '1.0.0',
  async salud() {
    return { estado: 'SALUDABLE', detalle: '' };
  },
  async ejecutar() {
    return { ...salida, ...extra } as SalidaAdaptador;
  },
});

const ok: SalidaAdaptador = { estado: 'OK', salida: { titulo: 'Hola' }, error: null };

describe('@soec/adaptadores · Sandbox autoritativo (C-1)', () => {
  it('estampa identidad autoritativa desde entradas confiables, ignorando junk del adaptador', async () => {
    // El adaptador cuela campos autoritativos falsos por runtime; el sandbox NO los usa.
    const mentiroso = adaptador(ok, { modo: 'REAL', adaptador: 'OTRO', version: '999', observadoEn: '1999-01-01T00:00:00Z', organizationId: 'org-x' });
    const { resultado, evidencia } = await sb.ejecutar(mentiroso, ctx('org-a', 'req-9'), solicitud(), cap(), O);
    expect(resultado.modoEjecutado).toBe('SIMULADO');
    expect(resultado.naturaleza).toBe('SIMULADA');
    expect(resultado.adaptador).toBe('fake');
    expect(resultado.version).toBe('1.0.0');
    expect(resultado.observadoEn).toBe(O);
    expect(resultado.organizationId).toBe('org-a');
    expect(resultado.requestId).toBe('req-9');
    expect(resultado.solicitudId).toBe('sol-1');
    expect(resultado.capacidadId).toBe('gen');
    expect(evidencia.evidenciaVersion).toBe(1);
    expect(evidencia.capacidadVersion).toBe(3);
    expect(evidencia.salud).toBe('SALUDABLE');
  });

  it('salida OK incoherente (sin salida) → INVALIDO', async () => {
    const roto = adaptador({ estado: 'OK', salida: null, error: null });
    const { resultado } = await sb.ejecutar(roto, ctx(), solicitud(), cap(), O);
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('INVALIDO');
  });

  it('salida ERROR sin error → INVALIDO', async () => {
    const roto = adaptador({ estado: 'ERROR', salida: null, error: null });
    const { resultado } = await sb.ejecutar(roto, ctx(), solicitud(), cap(), O);
    expect(resultado.error?.clase).toBe('INVALIDO');
  });

  it('normaliza una excepción no prevista → DESCONOCIDO sin filtrar el mensaje', async () => {
    const roto: AdaptadorExterno = {
      nombre: 'roto', capacidad: 'x', version: '1',
      async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
      async ejecutar() { throw new Error('detalle interno peligroso'); },
    };
    const { resultado } = await sb.ejecutar(roto, ctx(), solicitud(), cap(), O);
    expect(resultado.error?.clase).toBe('DESCONOCIDO');
    expect(JSON.stringify(resultado)).not.toContain('detalle interno peligroso');
  });
});

describe('@soec/adaptadores · Sandbox tenant/capacidad (C-2)', () => {
  it('rechaza si el CapacidadState no corresponde al tenant', async () => {
    const { resultado } = await sb.ejecutar(adaptador(ok), ctx('org-a'), solicitud(), cap({ organizationId: 'org-b' }), O);
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
  });

  it('rechaza si el CapacidadState no corresponde a la capacidad solicitada', async () => {
    const { resultado } = await sb.ejecutar(adaptador(ok), ctx('org-a'), solicitud({ capacidadId: 'gen' }), cap({ capacidadId: 'otra' }), O);
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
  });

  it('la evidencia lleva organizationId/capacidadId/solicitudId/requestId', async () => {
    const { evidencia } = await sb.ejecutar(adaptador(ok), ctx('org-a', 'req-7'), solicitud({ solicitudId: 's7' }), cap(), O);
    expect(evidencia.organizationId).toBe('org-a');
    expect(evidencia.capacidadId).toBe('gen');
    expect(evidencia.solicitudId).toBe('s7');
    expect(evidencia.requestId).toBe('req-7');
  });
});

describe('@soec/adaptadores · Sandbox cancelación (C-3)', () => {
  it('señal abortada ANTES → CANCELADO sin invocar al adaptador', async () => {
    let invocado = false;
    const espia: AdaptadorExterno = {
      nombre: 'espia', capacidad: 'x', version: '1',
      async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
      async ejecutar() { invocado = true; return ok; },
    };
    const c = new AbortController();
    c.abort('cancel');
    const { resultado } = await sb.ejecutar(espia, ctx(), solicitud(), cap(), O, { signal: c.signal });
    expect(resultado.error?.clase).toBe('CANCELADO');
    expect(invocado).toBe(false);
  });

  it('adaptador que IGNORA la señal + abortado durante → se descarta la respuesta (CANCELADO)', async () => {
    // La señal se aborta antes del await (pero pasamos el pre-check desactivándolo con un controller vivo).
    const c = new AbortController();
    const ignora: AdaptadorExterno = {
      nombre: 'ignora', capacidad: 'x', version: '1',
      async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
      async ejecutar() { c.abort('cancel'); return ok; }, // aborta durante la ejecución, ignora la señal
    };
    const { resultado } = await sb.ejecutar(ignora, ctx(), solicitud(), cap(), O, { signal: c.signal });
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('CANCELADO');
  });
});

describe('@soec/adaptadores · Sandbox inmutabilidad (C-5)', () => {
  it('resultado y evidencia quedan congelados', async () => {
    const { resultado, evidencia } = await sb.ejecutar(adaptador(ok), ctx(), solicitud(), cap(), O);
    expect(Object.isFrozen(resultado)).toBe(true);
    expect(Object.isFrozen(evidencia)).toBe(true);
    expect(() => {
      (resultado as unknown as { estado: string }).estado = 'ERROR';
    }).toThrow();
  });

  it('el adaptador no puede mutar la solicitud del sandbox', async () => {
    const sol = solicitud();
    const mutador: AdaptadorExterno = {
      nombre: 'mut', capacidad: 'x', version: '1',
      async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
      async ejecutar(_c, s: SolicitudAdaptador) {
        expect(() => {
          (s.peticion.parametros as Record<string, string>).a = 'MUTADO';
        }).toThrow();
        return ok;
      },
    };
    await sb.ejecutar(mutador, ctx(), sol, cap(), O);
    expect(sol.peticion.parametros.a).toBe('1'); // intacta
  });
});

describe('@soec/adaptadores · Sandbox gate REAL (C-4/C-6)', () => {
  it('REAL sin estado de frontera habilitado → NO_AUTORIZADO', async () => {
    const { resultado } = await sb.ejecutar(adaptador(ok), ctx(), solicitud(), cap(), O, { modoDeseado: 'REAL', estadoAdaptador: estadoInicialAdaptador() });
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
  });

  it('REAL con secretRef no opaca → INVALIDO', async () => {
    const estado = { ...frontHabilitado, secretRef: 'sk-REALabcdef1234567890' };
    const { resultado } = await sb.ejecutar(adaptador(ok), ctx(), solicitud(), cap(), O, { modoDeseado: 'REAL', estadoAdaptador: estado });
    expect(resultado.error?.clase).toBe('INVALIDO');
  });

  it('REAL con capacidad consumible saludable → ejecuta en modo REAL', async () => {
    const { resultado } = await sb.ejecutar(adaptador(ok), ctx(), solicitud(), cap(), O, { modoDeseado: 'REAL', estadoAdaptador: frontHabilitado });
    expect(resultado.estado).toBe('OK');
    expect(resultado.modoEjecutado).toBe('REAL');
    expect(resultado.naturaleza).toBe('REAL');
  });
});
