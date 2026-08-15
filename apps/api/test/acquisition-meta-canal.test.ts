/**
 * Meta channel account + secret refs — aislamiento por tenant y fail-closed (FASE 5-6).
 */
import { describe, expect, it } from 'vitest';
import { refsSecretosMeta, estadoCuentaMeta, buscarCuentaMeta } from '../src/plataforma/meta-canal';
import type { CuentaExternaRef } from '../src/plataforma/tipos';

describe('Meta canal · refs de secreto tenant-scoped', () => {
  it('CYP_SECRET != SMILEFLOW_SECRET: cada organización obtiene referencias distintas', () => {
    const cyp = refsSecretosMeta('org-cyp');
    const sf = refsSecretosMeta('org-smileflow');
    expect(cyp.pageToken).toBe('file:org-cyp/meta-page-token');
    expect(sf.pageToken).toBe('file:org-smileflow/meta-page-token');
    expect(cyp.pageToken).not.toBe(sf.pageToken);
    expect(cyp.appSecret).not.toBe(sf.appSecret);
  });

  it('las refs son opacas (file:<org>/…), nunca un valor de secreto', () => {
    const r = refsSecretosMeta('org-x');
    for (const ref of Object.values(r)) expect(ref).toMatch(/^file:org-x\/meta-/);
  });
});

describe('Meta canal · estado fail-closed', () => {
  it('sin cuenta ⇒ NOT_CONFIGURED', () => {
    expect(estadoCuentaMeta(null)).toBe('NOT_CONFIGURED');
    expect(buscarCuentaMeta([])).toBeNull();
  });

  it('con id pero sin credencial ⇒ CREDENTIALS_REQUIRED', () => {
    const cuenta: CuentaExternaRef = { proveedor: 'meta', externalAccountId: 'act_1', loginAccountId: null, credentialRef: null, estado: 'PENDING' };
    expect(estadoCuentaMeta(cuenta)).toBe('CREDENTIALS_REQUIRED');
  });

  it('con id + credencial + conectada ⇒ CONNECTED_READ_ONLY', () => {
    const cuenta: CuentaExternaRef = { proveedor: 'meta', externalAccountId: 'act_1', loginAccountId: null, credentialRef: 'file:org-x/meta-page-token', estado: 'CONNECTED_READ_ONLY' };
    expect(estadoCuentaMeta(cuenta)).toBe('CONNECTED_READ_ONLY');
  });

  it('CYP hoy: sin cuenta Meta ⇒ NOT_CONFIGURED (no se inventan ids)', () => {
    const cuentasCyp: readonly CuentaExternaRef[] = [
      { proveedor: 'ga4', externalAccountId: null, loginAccountId: null, credentialRef: null, estado: 'NOT_CONNECTED' },
    ];
    expect(estadoCuentaMeta(buscarCuentaMeta(cuentasCyp))).toBe('NOT_CONFIGURED');
  });
});
