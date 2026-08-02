/**
 * @soec/adaptadores · M4-C-A-H · aislamiento multi-tenant (C-2). La autoridad organizacional viene del
 * RequestContext y del CapacidadState, nunca del payload ni de la salida del adaptador. Una grabación de
 * la Org A no puede ser encontrada ni reutilizada por la Org B.
 */
import { describe, expect, it } from 'vitest';
import { AdaptadorGrabado, Sandbox, claveGrabacion } from '../src/index';
import { O, cap, ctx, solicitud } from './helpers';

const sb = new Sandbox();

describe('@soec/adaptadores · multi-tenant', () => {
  const sol = solicitud({ peticion: { operacion: 'consultar', parametros: { folio: '9' } } });
  const claveA = claveGrabacion('org-a', 'gen', '1.0.0', sol.peticion);
  const grabado = new AdaptadorGrabado({ [claveA]: { estado: 'vigente' } }, { version: '1.0.0' });

  it('Org A ejecuta su capacidad → OK', async () => {
    const { resultado } = await sb.ejecutar(grabado, ctx('org-a'), sol, cap({ organizationId: 'org-a' }), O);
    expect(resultado.estado).toBe('OK');
    expect(resultado.salida).toEqual({ estado: 'vigente' });
  });

  it('Org B NO puede reutilizar la grabación de Org A (clave scoped) → NO_DISPONIBLE', async () => {
    const { resultado } = await sb.ejecutar(grabado, ctx('org-b'), sol, cap({ organizationId: 'org-b' }), O);
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('NO_DISPONIBLE');
  });

  it('misma solicitudId en A y B → evidencias distintas (distinto tenant)', async () => {
    const eA = (await sb.ejecutar(grabado, ctx('org-a'), sol, cap({ organizationId: 'org-a' }), O)).evidencia;
    const eB = (await sb.ejecutar(grabado, ctx('org-b'), sol, cap({ organizationId: 'org-b' }), O)).evidencia;
    expect(eA.organizationId).not.toBe(eB.organizationId);
    expect(JSON.stringify(eA)).not.toBe(JSON.stringify(eB));
  });
});
