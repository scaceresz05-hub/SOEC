/**
 * @soec/secretos · M4-B · adaptador de FRONTERA sintético. Es el único lugar donde existe un valor, y sólo
 * lo entrega dentro de la caja opaca. Valida la referencia y falla ante referencia inválida / valor ausente.
 * Ninguna resolución aquí toca red real (Art. 4/12).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnMemoria, SecretoInvalidoError, SecretoNoEncontradoError } from '../src/index';

const ctx = (): RequestContext => {
  const o = OrganizationId('org-a');
  return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 't' };
};

describe('@soec/secretos · SecretStoreEnMemoria (sintético)', () => {
  it('resuelve una referencia válida a una caja opaca; el valor sólo sale por usar()', async () => {
    const store = new SecretStoreEnMemoria({ 'env:GEN_PRIMARY': 'valor-sintetico-xyz' });
    const sr = await store.resolver(ctx(), 'env:GEN_PRIMARY');
    expect(sr.secretRef).toBe('env:GEN_PRIMARY');
    expect(sr.usar((v) => v)).toBe('valor-sintetico-xyz');
    expect(String(sr)).not.toContain('valor-sintetico-xyz');
  });

  it('rechaza una referencia inválida (no opaca)', async () => {
    const store = new SecretStoreEnMemoria({});
    await expect(store.resolver(ctx(), 'sk-REALabcdef1234567890')).rejects.toBeInstanceOf(SecretoInvalidoError);
  });

  it('falla si no hay valor sintético para la referencia', async () => {
    const store = new SecretStoreEnMemoria({});
    await expect(store.resolver(ctx(), 'env:NO_EXISTE')).rejects.toBeInstanceOf(SecretoNoEncontradoError);
  });

  it('expone un nombre estable de adaptador', () => {
    expect(new SecretStoreEnMemoria().nombre).toBe('en-memoria-sintetico');
  });
});
