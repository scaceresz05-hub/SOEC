/**
 * @soec/secretos · M4-B/M4-BH · adaptador de FRONTERA sintético. Es el único lugar donde existe un valor, y
 * sólo lo entrega dentro de la caja opaca. F-1: el mapa interno (`#valores`) es inalcanzable e irredactable
 * por inspección/serialización/reflexión. Valida la referencia y falla ante referencia inválida / valor
 * ausente. Ninguna resolución aquí toca red real (Art. 4/12).
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnMemoria, SecretoInvalidoError, SecretoNoEncontradoError } from '../src/index';

const SENT = 'ZZ-SENTINELA-SINTETICA-9f3a2b1c';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 't' };
};

describe('@soec/secretos · SecretStoreEnMemoria (sintético)', () => {
  it('resuelve una referencia válida a una caja opaca; el valor sólo se usa por usar()', async () => {
    const store = new SecretStoreEnMemoria({ 'env:GEN_PRIMARY': SENT });
    const sr = await store.resolver(ctx(), 'env:GEN_PRIMARY');
    expect(sr.secretRef).toBe('env:GEN_PRIMARY');
    expect(sr.usar((v) => v === SENT)).toBe(true); // resultado NO secreto
    expect(String(sr)).not.toContain(SENT);
  });

  it('rechaza una referencia inválida (no opaca)', async () => {
    const store = new SecretStoreEnMemoria({});
    await expect(store.resolver(ctx(), 'sk-REALabcdef1234567890')).rejects.toBeInstanceOf(SecretoInvalidoError);
  });

  it('falla si no hay valor sintético para la referencia', async () => {
    const store = new SecretStoreEnMemoria({});
    await expect(store.resolver(ctx(), 'env:NO_EXISTE')).rejects.toBeInstanceOf(SecretoNoEncontradoError);
  });

  it('expone un nombre estable de adaptador y su cantidad (metadato no sensible)', () => {
    const store = new SecretStoreEnMemoria({ 'env:A': SENT, 'env:B': SENT });
    expect(store.nombre).toBe('en-memoria-sintetico');
    expect(store.cantidad).toBe(2);
  });

  it('F-1: NINGUNA superficie de inspección/reflexión revela el mapa ni el valor', () => {
    const store = new SecretStoreEnMemoria({ 'env:GEN_PRIMARY': SENT });
    const superficies: Record<string, string> = {
      'String()': String(store),
      'template': `${store}`,
      'inspect': inspect(store),
      'inspect deep': inspect({ n: [store] }, { depth: 5 }),
      'JSON.stringify': JSON.stringify(store),
      'JSON anidado': JSON.stringify({ a: store }),
      'Object.keys': JSON.stringify(Object.keys(store)),
      'Object.entries': JSON.stringify(Object.entries(store)),
      'Object.values': JSON.stringify(Object.values(store)),
      'spread': JSON.stringify({ ...store }),
      'getOwnPropertyNames': JSON.stringify(Object.getOwnPropertyNames(store)),
      'Reflect.ownKeys': JSON.stringify(Reflect.ownKeys(store).map(String)),
      'descriptors': JSON.stringify(Object.getOwnPropertyDescriptors(store)),
    };
    for (const [nombre, salida] of Object.entries(superficies)) {
      expect(salida?.includes(SENT), `${nombre} filtra el valor`).toBe(false);
      expect(salida ?? '', `${nombre} expone la clave interna 'valores'`).not.toMatch(/"valores"\s*:\s*\{[^}]/);
    }
    // #valores es campo privado real: no aparece en las claves propias.
    expect(Object.getOwnPropertyNames(store)).not.toContain('valores');
    expect(Object.getOwnPropertyNames(store)).not.toContain('#valores');
  });

  it('el adaptador no ofrece métodos de volcado (dump/getRaw/listValues/entries/values)', () => {
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(new SecretStoreEnMemoria()));
    for (const prohibido of ['dump', 'getRaw', 'listValues', 'entries', 'values', 'map']) {
      expect(proto, `expone ${prohibido}`).not.toContain(prohibido);
    }
  });

  it('misma secretRef en adaptadores de dos orgs → valores aislados', async () => {
    const a = new SecretStoreEnMemoria({ 'env:SHARED': 'valor-A' });
    const b = new SecretStoreEnMemoria({ 'env:SHARED': 'valor-B' });
    const ra = await a.resolver(ctx('org-a'), 'env:SHARED');
    const rb = await b.resolver(ctx('org-b'), 'env:SHARED');
    expect(ra.usar((v) => v === 'valor-A')).toBe(true);
    expect(rb.usar((v) => v === 'valor-B')).toBe(true);
  });
});
