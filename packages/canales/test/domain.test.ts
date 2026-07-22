import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  backoffMs,
  categoriaDesdeHttp,
  esModoBloqueado,
  esReintentable,
  modoHabilitado,
  reconciliar,
  transicionPubValida,
  validarFirmaWebhook,
  SECRETO_WEBHOOK_DEV,
  RATE_LIMIT_DEFECTO,
  type EstadoRemoto,
} from '../src';

describe('Dominio del plano de canales', () => {
  it('modos: simulado y sandbox habilitados; real desactivado por guardarraíl', () => {
    expect(modoHabilitado('simulado')).toBe(true);
    expect(modoHabilitado('sandbox')).toBe(true);
    expect(modoHabilitado('real_desactivado')).toBe(false);
    expect(esModoBloqueado('real_desactivado')).toBe(true);
  });

  it('la máquina de estados rechaza saltos inválidos', () => {
    expect(transicionPubValida('preparada', 'publicada')).toBe(false);
    expect(transicionPubValida('lista', 'publicada')).toBe(true);
    expect(transicionPubValida('fallida', 'verificada')).toBe(false);
    expect(transicionPubValida('retirada', 'publicada')).toBe(false);
    expect(transicionPubValida('verificada', 'retirada')).toBe(true);
  });

  it('clasifica errores por categoría y reintentabilidad', () => {
    expect(categoriaDesdeHttp(429)).toBe('rate_limit');
    expect(categoriaDesdeHttp(401)).toBe('credencial');
    expect(categoriaDesdeHttp(504)).toBe('timeout');
    expect(esReintentable('rate_limit')).toBe(true);
    expect(esReintentable('credencial')).toBe(false);
  });

  it('el backoff con jitter es determinista (sin azar) y respeta Retry-After', () => {
    const a = backoffMs(RATE_LIMIT_DEFECTO, 2, 'pub-1');
    const b = backoffMs(RATE_LIMIT_DEFECTO, 2, 'pub-1');
    expect(a).toBe(b);
    expect(backoffMs(RATE_LIMIT_DEFECTO, 1, 'pub-1', 5000)).toBe(5000);
  });

  it('reconcilia: sin rastro → fallida; publicado → verificada; eliminado → retirada; divergente → intervención', () => {
    const remoto = (over: Partial<EstadoRemoto>): EstadoRemoto => ({ existe: true, status: 'published', externalRef: 'ext-1', publishedAt: null, ...over });
    expect(reconciliar('desconocida', null).nuevoEstado).toBe('fallida');
    expect(reconciliar('desconocida', remoto({ status: 'published' })).nuevoEstado).toBe('verificada');
    expect(reconciliar('publicada', remoto({ status: 'deleted' })).nuevoEstado).toBe('retirada');
    const div = reconciliar('desconocida', remoto({ status: 'raro' }));
    expect(div.requiereIntervencion).toBe(true);
  });

  it('valida la firma HMAC del webhook y rechaza firmas inválidas', () => {
    const cuerpo = JSON.stringify({ tipo: 'post.published', externalId: 'ext-1', status: 'published' });
    const firma = createHmac('sha256', SECRETO_WEBHOOK_DEV).update(cuerpo).digest('hex');
    expect(validarFirmaWebhook('wh-1', 'post.published', 'ext-1', 'published', firma)).toBe(true);
    expect(validarFirmaWebhook('wh-1', 'post.published', 'ext-1', 'published', 'firma-mala')).toBe(false);
  });
});
