/**
 * @soec/secretos · tests · SecretStoreEnv (adaptador productivo por entorno).
 * Resuelve `env:NOMBRE`; falla si la variable no existe; rechaza esquemas no-env y refs inválidas; nunca
 * serializa el valor; secretRef != secretValue.
 */
import { describe, it, expect } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '../src/index';

function ctx(): RequestContext {
  const o = OrganizationId('org-a');
  return { organizationId: o, actor: ActorId('svc'), scope: { organizationId: o, permissions: [] }, correlationId: 't' };
}
const REF = 'env:SMILEFLOW_GROWTH_TOKEN';

describe('SecretStoreEnv', () => {
  it('resuelve env:NOMBRE y expone el valor sólo dentro de usar()', async () => {
    const store = new SecretStoreEnv({ SMILEFLOW_GROWTH_TOKEN: 'valor-secreto-de-prueba' });
    const resuelto = await store.resolver(ctx(), REF);
    // usar() no puede devolver el valor crudo (guard anti-fuga); derivamos algo no-secreto.
    expect(resuelto.usar((v) => v === 'valor-secreto-de-prueba')).toBe(true);
  });

  it('falla si la variable de entorno no existe', async () => {
    const store = new SecretStoreEnv({});
    await expect(store.resolver(ctx(), REF)).rejects.toThrow();
  });

  it('rechaza esquemas que no sean env:', async () => {
    const store = new SecretStoreEnv({});
    await expect(store.resolver(ctx(), 'vault://org/x')).rejects.toThrow();
  });

  it('rechaza una secretRef inválida (no es referencia opaca)', async () => {
    const store = new SecretStoreEnv({ X: 'y' });
    await expect(store.resolver(ctx(), 'sk-1234567890abcdef')).rejects.toThrow();
  });

  it('no serializa ni expone el valor (redactado)', async () => {
    const store = new SecretStoreEnv({ SMILEFLOW_GROWTH_TOKEN: 'valor-secreto-de-prueba' });
    expect(JSON.stringify(store)).not.toContain('valor-secreto-de-prueba');
    expect(String(store)).not.toContain('valor-secreto-de-prueba');
    // secretRef != secretValue
    const resuelto = await store.resolver(ctx(), REF);
    expect(String(resuelto)).not.toContain('valor-secreto-de-prueba');
  });
});
