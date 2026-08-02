/**
 * @soec/adaptadores · M4-C-A-H · SMOKE opt-in DETERMINISTA contra fake/grabado — SIN proveedor real, SIN
 * red, SIN credencial. Seguro en `verify`. El smoke contra proveedores REALES es un mecanismo aparte,
 * opt-in y explícito, y NUNCA se ejecuta dentro de `verify` (diferido a M4-C-B).
 */
import { describe, expect, it } from 'vitest';
import { AdaptadorFake, AdaptadorGrabado, Sandbox, claveGrabacion } from '../src/index';
import { O, cap, ctx, solicitud } from './helpers';

const sb = new Sandbox();

describe('@soec/adaptadores · smoke opt-in (fake/grabado, determinista)', () => {
  it('flujo fake: identidad autoritativa + evidencia + salud', async () => {
    const fake = new AdaptadorFake({ capacidad: 'generacion', respuestas: { generar: { titulo: 'Piloto' } } });
    const { resultado, evidencia } = await sb.ejecutar(fake, ctx('org-a', 'req-s'), solicitud(), cap(), O);
    expect(resultado.estado).toBe('OK');
    expect(resultado.salida).toEqual({ titulo: 'Piloto' });
    expect(resultado.organizationId).toBe('org-a');
    expect(evidencia.salud).toBe('SALUDABLE');
    expect(evidencia.evidenciaVersion).toBe(1);
  });

  it('flujo grabado: evidencia reproducible por scope', async () => {
    const sol = solicitud({ peticion: { operacion: 'consultar', parametros: { folio: '9' } } });
    const clave = claveGrabacion('org-a', 'gen', '1.0.0', sol.peticion);
    const grabado = new AdaptadorGrabado({ [clave]: { estado: 'vigente' } }, { version: '1.0.0' });
    const a = await sb.ejecutar(grabado, ctx('org-a'), sol, cap(), O);
    const b = await sb.ejecutar(grabado, ctx('org-a'), sol, cap(), O);
    expect(a.resultado).toEqual(b.resultado);
    expect(a.resultado.salida).toEqual({ estado: 'vigente' });
  });
});
