/** Limitador de intentos: bloqueo tras N fallos, desbloqueo al expirar, reinicio por éxito. */
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/rate-limit';

describe('RateLimiter', () => {
  it('bloquea tras alcanzar el máximo de fallos y desbloquea al expirar el bloqueo', () => {
    let t = 0;
    const rl = new RateLimiter({ maxIntentos: 3, ventanaMs: 1000, bloqueoMs: 5000, now: () => t });
    expect(rl.revisar('k').permitido).toBe(true);
    rl.registrarFallo('k');
    rl.registrarFallo('k');
    expect(rl.revisar('k').permitido).toBe(true); // aún bajo el umbral
    const r = rl.registrarFallo('k'); // tercero → bloquea
    expect(r.permitido).toBe(false);
    expect(r.retryAfterSeg).toBeGreaterThan(0);
    expect(rl.revisar('k').permitido).toBe(false);
    t = 5001; // transcurre el bloqueo
    expect(rl.revisar('k').permitido).toBe(true);
  });

  it('un éxito limpia el contador de la clave', () => {
    const t = 0;
    const rl = new RateLimiter({ maxIntentos: 2, ventanaMs: 1000, bloqueoMs: 1000, now: () => t });
    rl.registrarFallo('k');
    rl.registrarExito('k');
    // contador reiniciado: un único fallo no bloquea
    expect(rl.registrarFallo('k').permitido).toBe(true);
  });

  it('los fallos fuera de la ventana no se acumulan', () => {
    let t = 0;
    const rl = new RateLimiter({ maxIntentos: 2, ventanaMs: 1000, bloqueoMs: 1000, now: () => t });
    rl.registrarFallo('k');
    t = 2000; // fuera de la ventana → reinicia el conteo
    expect(rl.registrarFallo('k').permitido).toBe(true);
  });
});
