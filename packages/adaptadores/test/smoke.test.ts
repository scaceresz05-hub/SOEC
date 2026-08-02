/**
 * @soec/adaptadores · M4-C-A · SMOKE opt-in DETERMINISTA. Ejercita el flujo de frontera de punta a punta
 * contra adaptadores fake/grabado — SIN proveedor real, SIN red, SIN credencial. Es seguro correr en
 * `verify`. El smoke contra PROVEEDORES REALES es un mecanismo aparte, opt-in y explícito, y NUNCA se
 * ejecuta dentro de `verify` (queda diferido a M4-C-B).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { AdaptadorFake, AdaptadorGrabado, Sandbox, claveEvidencia } from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (): RequestContext => {
  const o = OrganizationId('org-a');
  return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 't' };
};

describe('@soec/adaptadores · smoke opt-in (fake/grabado, determinista)', () => {
  const sb = new Sandbox();

  it('flujo fake: salud + ejecución + evidencia', async () => {
    const fake = new AdaptadorFake({ capacidad: 'generacion', respuestas: { generar: { titulo: 'Piloto' } }, salud: 'SALUDABLE' });
    const { resultado, evidencia } = await sb.ejecutar(fake, ctx(), { operacion: 'generar', parametros: { tema: 'agua' } }, O);
    expect(resultado.estado).toBe('OK');
    expect(resultado.salida).toEqual({ titulo: 'Piloto' });
    expect(evidencia.salud).toBe('SALUDABLE');
    expect(evidencia.clave).toBe('generar(tema=agua)');
  });

  it('flujo grabado: evidencia reproducible por clave', async () => {
    const peticion = { operacion: 'consultar', parametros: { folio: '9' } };
    const grabado = new AdaptadorGrabado({ [claveEvidencia(peticion)]: { estado: 'vigente' } }, { capacidad: 'consulta' });
    const a = await sb.ejecutar(grabado, ctx(), peticion, O);
    const b = await sb.ejecutar(grabado, ctx(), peticion, O);
    expect(a.resultado).toEqual(b.resultado); // reproducible
    expect(a.resultado.salida).toEqual({ estado: 'vigente' });
  });
});
