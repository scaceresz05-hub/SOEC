/**
 * @soec/adaptadores · M4-C-B · políticas operativas: compatibilidad, health fail-safe, circuit breaker
 * determinista (reloj inyectado), retry gobernado y concurrencia con liberación garantizada.
 */
import { describe, expect, it } from 'vitest';
import {
  LimitadorConcurrencia,
  RETRY_DESHABILITADO,
  decidirRetry,
  efectoSalud,
  evaluarBreaker,
  registrarResultadoBreaker,
  verificarCompatibilidad,
  CIRCUIT_BREAKER_CERRADO,
} from '../src/index';

const compat = { contratoId: 'gen', versionesContratoSoportadas: ['1.0.0', '1.1.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' };
const politicaBreaker = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' };
const limite = { maxConcurrentesPorOrganizacion: 2, maxConcurrentesPorAdaptador: 1, maxConcurrentesPorCapacidad: 2, version: '1' };

describe('@soec/adaptadores · compatibilidad', () => {
  it('compatible cuando contrato/versión/evidencia coinciden', () => {
    expect(verificarCompatibilidad({ contratoId: 'gen', contratoVersion: '1.1.0', evidenciaSchemaVersion: '1' }, compat).compatible).toBe(true);
  });
  it('INCOMPATIBLE por versión no soportada / contrato / evidencia', () => {
    expect(verificarCompatibilidad({ contratoId: 'gen', contratoVersion: '2.0.0', evidenciaSchemaVersion: '1' }, compat).compatible).toBe(false);
    expect(verificarCompatibilidad({ contratoId: 'otro', contratoVersion: '1.0.0', evidenciaSchemaVersion: '1' }, compat).compatible).toBe(false);
    expect(verificarCompatibilidad({ contratoId: 'gen', contratoVersion: '1.0.0', evidenciaSchemaVersion: '9' }, compat).compatible).toBe(false);
  });
});

describe('@soec/adaptadores · health fail-safe', () => {
  it('NO_CONFIABLE bloquea; DESCONOCIDA no permite REAL; SALUDABLE permite', () => {
    expect(efectoSalud('NO_CONFIABLE', 'SIMULADO').permite).toBe(false);
    expect(efectoSalud('DESCONOCIDA', 'REAL').permite).toBe(false);
    expect(efectoSalud('DESCONOCIDA', 'SIMULADO').permite).toBe(true);
    expect(efectoSalud('SALUDABLE', 'REAL').permite).toBe(true);
  });
});

describe('@soec/adaptadores · circuit breaker (determinista)', () => {
  const T0 = '2026-08-02T00:00:00.000Z';
  const T31 = '2026-08-02T00:00:31.000Z'; // +31s > 30s reapertura

  it('abre tras N fallos consecutivos y bloquea', () => {
    let e = CIRCUIT_BREAKER_CERRADO;
    e = registrarResultadoBreaker(e, politicaBreaker, false, T0);
    e = registrarResultadoBreaker(e, politicaBreaker, false, T0);
    expect(e.estado).toBe('CERRADO');
    e = registrarResultadoBreaker(e, politicaBreaker, false, T0);
    expect(e.estado).toBe('ABIERTO');
    expect(evaluarBreaker(e, politicaBreaker, T0).permitido).toBe(false);
  });

  it('pasa a SEMIABIERTO tras el tiempo de reapertura (instante inyectado)', () => {
    let e = { estado: 'ABIERTO' as const, fallosConsecutivos: 3, abiertoDesde: T0 };
    expect(evaluarBreaker(e, politicaBreaker, T0).permitido).toBe(false);
    const ev = evaluarBreaker(e, politicaBreaker, T31);
    expect(ev.permitido).toBe(true);
    expect(ev.estado.estado).toBe('SEMIABIERTO');
    // fallo en SEMIABIERTO → reabre
    e = registrarResultadoBreaker(ev.estado, politicaBreaker, false, T31);
    expect(e.estado).toBe('ABIERTO');
  });

  it('éxito reinicia a CERRADO', () => {
    const abierto = { estado: 'ABIERTO' as const, fallosConsecutivos: 5, abiertoDesde: T0 };
    expect(registrarResultadoBreaker(abierto, politicaBreaker, true, T31)).toEqual(CIRCUIT_BREAKER_CERRADO);
  });
});

describe('@soec/adaptadores · retry gobernado', () => {
  it('deshabilitado por defecto', () => {
    expect(decidirRetry(RETRY_DESHABILITADO, 1, 'TIMEOUT').reintentar).toBe(false);
  });
  it('nunca reintenta INVALIDO/NO_AUTORIZADO/CANCELADO', () => {
    const p = { habilitado: true, maxIntentos: 3, erroresReintentables: ['INVALIDO', 'CANCELADO', 'TIMEOUT'] as const, backoff: 'FIJO' as const, baseMs: 10, jitter: false as const, version: '1' };
    expect(decidirRetry(p, 1, 'INVALIDO').reintentar).toBe(false);
    expect(decidirRetry(p, 1, 'CANCELADO').reintentar).toBe(false);
    expect(decidirRetry(p, 1, 'TIMEOUT').reintentar).toBe(true);
  });
  it('respeta maxIntentos y backoff exponencial determinista', () => {
    const p = { habilitado: true, maxIntentos: 3, erroresReintentables: ['NO_DISPONIBLE'] as const, backoff: 'EXPONENCIAL' as const, baseMs: 10, jitter: false as const, version: '1' };
    expect(decidirRetry(p, 1, 'NO_DISPONIBLE').esperaMs).toBe(10);
    expect(decidirRetry(p, 2, 'NO_DISPONIBLE').esperaMs).toBe(20);
    expect(decidirRetry(p, 3, 'NO_DISPONIBLE').reintentar).toBe(false);
  });
});

describe('@soec/adaptadores · concurrencia', () => {
  it('límite por adaptador alcanzado → sin permiso; libera y vuelve a permitir', () => {
    const l = new LimitadorConcurrencia();
    const r1 = l.adquirir('org-a', 'gen-1', 'gen', limite);
    expect(r1).not.toBeNull();
    expect(l.adquirir('org-a', 'gen-1', 'gen', limite)).toBeNull(); // maxPorAdaptador=1
    r1?.();
    expect(l.adquirir('org-a', 'gen-1', 'gen', limite)).not.toBeNull();
  });

  it('ejecutarConLimite libera SIEMPRE (incluso ante excepción)', async () => {
    const l = new LimitadorConcurrencia();
    await expect(
      l.ejecutarConLimite('org-a', 'gen-1', 'gen', limite, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(l.enCursoOrg('org-a')).toBe(0); // liberado pese a la excepción
  });

  it('aísla por organización', () => {
    const l = new LimitadorConcurrencia();
    l.adquirir('org-a', 'gen-1', 'gen', limite);
    l.adquirir('org-a', 'gen-1', 'gen', limite); // null, pero no afecta a org-b
    expect(l.adquirir('org-b', 'gen-1', 'gen', limite)).not.toBeNull();
  });

  it('liberación idempotente', () => {
    const l = new LimitadorConcurrencia();
    const r = l.adquirir('org-a', 'gen-1', 'gen', limite);
    r?.();
    r?.(); // no baja de cero
    expect(l.enCursoOrg('org-a')).toBe(0);
  });
});
