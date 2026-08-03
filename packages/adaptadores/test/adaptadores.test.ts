/**
 * @soec/adaptadores · M4-C-A-H · adaptadores fake y grabado bajo el contrato NO autoritativo. Sólo aportan
 * salida funcional (estado/salida/error); no fijan modo, identidad ni instante. Grabado scoped por tenant.
 */
import { describe, expect, it } from 'vitest';
import { AdaptadorFake, AdaptadorGrabado, claveGrabacion, errorNormalizado } from '../src/index';
import { ctx, solicitud } from './helpers';

describe('@soec/adaptadores · AdaptadorFake (no autoritativo)', () => {
  it('responde OK con la salida configurada; no expone campos autoritativos', async () => {
    const fake = new AdaptadorFake({ respuestas: { generar: { titulo: 'Hola' } } });
    const s = await fake.ejecutar(ctx(), solicitud());
    expect(s.estado).toBe('OK');
    expect(s.salida).toEqual({ titulo: 'Hola' });
    expect('modo' in s).toBe(false);
    expect('observadoEn' in s).toBe(false);
    expect('adaptador' in s).toBe(false);
  });

  it('operación no soportada → INVALIDO', async () => {
    const fake = new AdaptadorFake({ respuestas: {} });
    const s = await fake.ejecutar(ctx(), solicitud({ peticion: { operacion: 'x', parametros: {} } }));
    expect(s.error?.clase).toBe('INVALIDO');
  });

  it('errorForzado normalizado', async () => {
    const fake = new AdaptadorFake({ errorForzado: errorNormalizado('LIMITE', 'cuota') });
    const s = await fake.ejecutar(ctx(), solicitud());
    expect(s.error?.clase).toBe('LIMITE');
    expect(s.error?.reintentable).toBe(true);
  });

  it('salud sin instante (lo estampa el sandbox)', async () => {
    const fake = new AdaptadorFake({ salud: 'DEGRADADO' });
    expect(await fake.salud()).toEqual({ estado: 'DEGRADADO', detalle: 'fake' });
  });
});

describe('@soec/adaptadores · AdaptadorGrabado (scoped por tenant/capacidad/versión)', () => {
  it('reproduce por la clave scoped', async () => {
    const sol = solicitud({ peticion: { operacion: 'consultar', parametros: { folio: '9' } } });
    const clave = claveGrabacion('org-a', 'gen', '1.0.0', sol.peticion);
    const grabado = new AdaptadorGrabado({ [clave]: { ok: 'sí' } }, { version: '1.0.0' });
    const s = await grabado.ejecutar(ctx('org-a'), sol);
    expect(s.estado).toBe('OK');
    expect(s.salida).toEqual({ ok: 'sí' });
    expect(clave).toBe('org-a::gen::1.0.0::consultar(folio=9)');
  });

  it('sin grabación para el scope → NO_DISPONIBLE', async () => {
    const grabado = new AdaptadorGrabado({}, { version: '1.0.0' });
    const s = await grabado.ejecutar(ctx('org-a'), solicitud());
    expect(s.error?.clase).toBe('NO_DISPONIBLE');
  });
});
