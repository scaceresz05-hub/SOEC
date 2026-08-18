/**
 * Meta DATA DELETION — verificación del signed_request (firma HMAC-SHA256 con el app secret).
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseSignedRequest } from '../src/acquisition/meta-data-deletion';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function firmar(payloadObj: unknown, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(payloadObj), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${sig}.${payload}`;
}

describe('data deletion · signed_request', () => {
  it('firma válida ⇒ userId extraído', () => {
    const r = parseSignedRequest(firmar({ user_id: 'u123', algorithm: 'HMAC-SHA256' }, 's3cr3t'), 's3cr3t');
    expect(r.valido).toBe(true);
    expect(r.userId).toBe('u123');
  });
  it('firma con secreto equivocado ⇒ inválida', () => {
    expect(parseSignedRequest(firmar({ user_id: 'u123' }, 'bueno'), 'malo').valido).toBe(false);
  });
  it('formato inválido ⇒ inválida', () => {
    expect(parseSignedRequest('sin-punto', 's').valido).toBe(false);
    expect(parseSignedRequest('a.b.c', 's').valido).toBe(false);
  });
});
