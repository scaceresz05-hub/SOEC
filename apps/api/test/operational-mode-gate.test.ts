/**
 * REPAIR — el gate supervisedReal deriva del operationalMode de la ORGANIZACIÓN autenticada (fuente única),
 * no de una env var. El gateway inyecta x-operational-mode desde la membresía validada (no del payload);
 * derivarFlagsDeModo mapea PILOT→false / SUPERVISED_REAL→true / desconocido→false (fail-closed); autonomousReal
 * siempre false. Read model y executor comparten la misma resolución.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { IdentityService } from '@soec/identity';
import { guardarVerticales } from '../src/vertical-gateway';
import { modoOperativoDe } from '../src/superficie-auth';
import { derivarFlagsDeModo } from '../src/campana/authorized-execution-envelope';

const req = (headers: Record<string, string>): FastifyRequest => ({ headers } as unknown as FastifyRequest);
const identityConModo = (operationalMode: string): IdentityService => ({
  resolverSesion: async () => ({ user: { id: 'u1' } }),
  resolverContextoOrganizacion: async () => ({ user: { id: 'u1' }, organization: { slug: 'org-smileflow', name: 'SmileFlow', operationalMode }, membership: { role: 'admin' }, permisos: new Set(['business.manage']) }),
} as unknown as IdentityService);

describe('derivarFlagsDeModo (fuente única, fail-closed)', () => {
  it('PILOT ⇒ supervisedReal=false', () => {
    expect(derivarFlagsDeModo('PILOT')).toEqual({ supervisedReal: false, autonomousReal: false });
  });
  it('SUPERVISED_REAL ⇒ supervisedReal=true', () => {
    expect(derivarFlagsDeModo('SUPERVISED_REAL')).toEqual({ supervisedReal: true, autonomousReal: false });
  });
  it('desconocido/null/vacío ⇒ supervisedReal=false (fail-closed)', () => {
    for (const m of ['AUTONOMOUS_REAL', 'OTRO', '', null, undefined]) {
      expect(derivarFlagsDeModo(m).supervisedReal).toBe(false);
    }
  });
  it('autonomousReal SIEMPRE false (incluso con un modo que lo insinúe)', () => {
    expect(derivarFlagsDeModo('AUTONOMOUS_REAL').autonomousReal).toBe(false);
    expect(derivarFlagsDeModo('SUPERVISED_REAL').autonomousReal).toBe(false);
  });
});

describe('modoOperativoDe (lee la cabecera autoritativa)', () => {
  it('devuelve el modo del header; null si ausente/vacío', () => {
    expect(modoOperativoDe(req({ 'x-operational-mode': 'SUPERVISED_REAL' }))).toBe('SUPERVISED_REAL');
    expect(modoOperativoDe(req({}))).toBeNull();
    expect(modoOperativoDe(req({ 'x-operational-mode': '  ' }))).toBeNull();
  });
});

describe('gateway inyecta x-operational-mode desde la membresía validada (no del payload)', () => {
  it('inyecta el operationalMode de la organización', async () => {
    const r = req({ cookie: 'soec_session=tok', 'x-organization-slug': 'org-smileflow' });
    await guardarVerticales(identityConModo('SUPERVISED_REAL'))(r);
    expect(r.headers['x-operational-mode']).toBe('SUPERVISED_REAL');
  });
  it('SOBREESCRIBE un x-operational-mode enviado por el cliente (anti-spoofing)', async () => {
    const r = req({ cookie: 'soec_session=tok', 'x-organization-slug': 'org-smileflow', 'x-operational-mode': 'SUPERVISED_REAL' });
    await guardarVerticales(identityConModo('PILOT'))(r); // la org real está en PILOT
    expect(r.headers['x-operational-mode']).toBe('PILOT'); // el valor del cliente se descarta
    expect(derivarFlagsDeModo(modoOperativoDe(r)).supervisedReal).toBe(false);
  });
});
