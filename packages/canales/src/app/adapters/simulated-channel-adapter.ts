/**
 * Adaptador de canal SIMULADO (modo `simulado`, F2-CHAN-01 §2). No llama a ningún
 * proveedor ni cruza la red: publica en su propio almacén en memoria. Determinista →
 * idempotente. Sirve para pruebas locales y para el modo por defecto seguro.
 */
import { createHash } from 'node:crypto';
import type { CanalCapabilities } from '../../domain/capabilities';
import type { AdaptadorCanal, ContextoEnvio, EstadoRemoto, ResultadoEnvio } from '../../domain/ports';
import { capacidadesDeCanal } from '../capabilities-catalog';

interface PostSim {
  externalRef: string;
  status: string;
  idempotencyKey: string;
}

export class AdaptadorCanalSimulado implements AdaptadorCanal {
  readonly nombre = 'canal-simulado';
  readonly version = '1.0.0';
  readonly modo = 'simulado' as const;
  private readonly posts = new Map<string, PostSim>();
  private readonly porIdem = new Map<string, string>();

  soporta(canal: string): boolean {
    return capacidadesDeCanal(canal) !== null;
  }
  capacidades(canal: string): CanalCapabilities {
    const c = capacidadesDeCanal(canal);
    if (!c) throw new Error(`canal no soportado: ${canal}`);
    return c;
  }

  async enviar(ctx: ContextoEnvio): Promise<ResultadoEnvio> {
    // Idempotencia: la misma clave nunca crea dos publicaciones.
    const existente = this.porIdem.get(ctx.idempotencyKey);
    if (existente) {
      const p = this.posts.get(existente)!;
      return { resultado: 'publicada', externalRef: p.externalRef, estadoRemoto: p.status, error: null, retryAfterMs: null };
    }
    const externalRef = 'sim-' + createHash('sha256').update(ctx.idempotencyKey).digest('hex').slice(0, 16);
    this.posts.set(externalRef, { externalRef, status: 'published', idempotencyKey: ctx.idempotencyKey });
    this.porIdem.set(ctx.idempotencyKey, externalRef);
    return { resultado: 'publicada', externalRef, estadoRemoto: 'published', error: null, retryAfterMs: null };
  }

  async verificar(externalRef: string): Promise<EstadoRemoto> {
    const p = this.posts.get(externalRef);
    if (!p || p.status === 'deleted') return { existe: false, status: 'not_found', externalRef, publishedAt: null };
    return { existe: true, status: p.status, externalRef, publishedAt: '2026-07-21T00:00:00.000Z' };
  }

  async buscarPorIdempotencia(idempotencyKey: string): Promise<EstadoRemoto | null> {
    const ref = this.porIdem.get(idempotencyKey);
    if (!ref) return null;
    return this.verificar(ref);
  }

  async retirar(externalRef: string): Promise<{ ok: boolean; status: string }> {
    const p = this.posts.get(externalRef);
    if (!p || p.status === 'deleted') return { ok: false, status: 'not_found' };
    p.status = 'deleted';
    return { ok: true, status: 'deleted' };
  }
}
