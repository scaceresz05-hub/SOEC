/**
 * Backend de secretos por envelope+KMS — matriz de seguridad (FASE 18). Secretos SINTÉTICOS; KMS fake.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  EnvelopeSecretBackend,
  InMemoryCiphertextStore,
  KmsFake,
  assertBackendSeguroEnProduccion,
  ResolucionSecretoError,
} from '../src/acquisition/meta-secret-backend';
import { redactarSecretos } from '../src/acquisition/meta-organic';

const SECRETO = 'SYNTHETIC_SECRET_do_not_use_9f3a';

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c' };
}
function backend() {
  const store = new InMemoryCiphertextStore();
  return { be: new EnvelopeSecretBackend(new KmsFake(), store), store };
}

describe('envelope backend · write→resolve→delete (contract)', () => {
  it('SYNTHETIC_STORE_RESOLVE_DELETE: round-trip exacto; tras borrar, resolve falla', async () => {
    const { be } = backend();
    const { secretRef } = await be.almacenar('org-smileflow', 'meta-user-token', SECRETO);
    const resuelto = await be.resolver(ctx('org-smileflow'), secretRef);
    expect(resuelto.usar((v) => v === SECRETO)).toBe(true); // valor exacto, dentro de la caja opaca
    await be.revocar(secretRef);
    await expect(be.resolver(ctx('org-smileflow'), secretRef)).rejects.toBeInstanceOf(ResolucionSecretoError);
  });

  it('SECRET_REF_CONTAINS_NO_SECRET / CIPHERTEXT_NOT_PLAINTEXT', async () => {
    const { be, store } = backend();
    const { secretRef } = await be.almacenar('org-smileflow', 'meta-user-token', SECRETO);
    expect(secretRef).toBe('secretstore:org-smileflow/meta-user-token');
    expect(secretRef).not.toContain(SECRETO);
    const blob = await store.get('org-smileflow/meta-user-token');
    expect(JSON.stringify(blob)).not.toContain(SECRETO); // el token no está en claro en el store
  });
});

describe('envelope backend · aislamiento por tenant y refs', () => {
  it('CROSS_TENANT_RESOLVE_REJECT: Org B no resuelve el secreto de Org A', async () => {
    const { be } = backend();
    const { secretRef } = await be.almacenar('org-a', 'meta-user-token', SECRETO);
    expect((await be.resolver(ctx('org-a'), secretRef)).usar((v) => v === SECRETO)).toBe(true);
    await expect(be.resolver(ctx('org-b'), secretRef)).rejects.toBeInstanceOf(ResolucionSecretoError);
  });
  it('FORGED/MALFORMED_REF_REJECT', async () => {
    const { be } = backend();
    await expect(be.resolver(ctx('org-a'), 'secretstore:org-a/inexistente')).rejects.toBeInstanceOf(ResolucionSecretoError);
    await expect(be.resolver(ctx('org-a'), 'basura-no-ref')).rejects.toBeInstanceOf(ResolucionSecretoError);
  });
});

describe('envelope backend · integridad (GCM) y salud', () => {
  it('TAMPERED_CIPHERTEXT_FAILS: manipular el blob rompe la autenticación GCM', async () => {
    const { be, store } = backend();
    const { secretRef } = await be.almacenar('org-a', 'meta-user-token', SECRETO);
    const blob = (await store.get('org-a/meta-user-token'))!;
    const ctBuf = Buffer.from(blob.ciphertext, 'base64');
    ctBuf[0] = ctBuf[0]! ^ 0xff; // corromper 1 byte
    await store.put('org-a/meta-user-token', { ...blob, ciphertext: ctBuf.toString('base64') });
    await expect(be.resolver(ctx('org-a'), secretRef)).rejects.toBeDefined();
  });
  it('BACKEND_HEALTH desde el KMS', async () => {
    const { be } = backend();
    expect(await be.salud()).toBe('AVAILABLE');
  });
});

describe('envelope backend · gate de producción', () => {
  it('PRODUCTION_CANNOT_USE_FAKE_BACKEND', () => {
    const { be } = backend(); // KmsFake ⇒ esProductivo false
    expect(be.esProductivo).toBe(false);
    expect(() => assertBackendSeguroEnProduccion('production', be)).toThrow();
    expect(() => assertBackendSeguroEnProduccion('test', be)).not.toThrow();
    expect(() => assertBackendSeguroEnProduccion('production', { esProductivo: true })).not.toThrow();
  });
});

describe('sanitización · OAuth code', () => {
  it('OAUTH_CODE_REDACTED junto a Bearer y access_token', () => {
    const s = redactarSecretos('cb https://soec/cb?code=SYNTH_CODE_xyz&state=s; Authorization: Bearer SYNTH_B_1; ?access_token=SYNTH_T_2');
    expect(s).not.toContain('SYNTH_CODE_xyz');
    expect(s).not.toContain('SYNTH_B_1');
    expect(s).not.toContain('SYNTH_T_2');
    expect(s).toContain('code=[REDACTED]');
    expect(s).toContain('state=s'); // parámetros no sensibles se preservan
  });
});
