/**
 * @soec/adaptadores · M4-C-C · resiliencia temporal. F-CB-3: reevaluación de gates entre reintentos con
 * backoff (revocación/expiración/cancelación/incompatibilidad/breaker/salud detienen la secuencia). F-CB-4:
 * single-probe SEMIABIERTO con lease, liberación garantizada y aislamiento por organización.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  type AdaptadorExterno,
  type ProgramadorEspera,
  type RegistroAdaptador,
  CoordinadorSemiabierto,
  OrquestadorAdaptadores,
  ProgramadorEsperaGrabado,
  CIRCUIT_BREAKER_CERRADO,
  crearDescriptor,
  isoSumarMs,
} from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('s'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'req-1' };
};
const solicitud = { solicitudId: 'sol-1', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: { a: '1' } } };
const cap = (): CapacidadState => ({
  organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'SIMULADA', salud: 'SALUDABLE',
  politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false,
});
const politicaBreaker = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' };
const politicaRetry = { habilitado: true, maxIntentos: 4, erroresReintentables: ['NO_DISPONIBLE'] as const, backoff: 'FIJO' as const, baseMs: 100, jitter: false as const, version: '1' };
const reg = (over: Partial<RegistroAdaptador> = {}): RegistroAdaptador => ({
  organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0',
  estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO,
  expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: null, creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4, ...over,
});
// Adaptador que siempre falla con error reintentable → fuerza el bucle de retry.
const fallaReintentable = (): AdaptadorExterno => ({
  nombre: 'gen-1', capacidad: 'gen', version: '1.0.0',
  async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
  async ejecutar() { return { estado: 'ERROR', salida: null, error: { clase: 'NO_DISPONIBLE', mensaje: 'x', reintentable: true } }; },
});
const orq = new OrquestadorAdaptadores();

describe('@soec/adaptadores · reevaluación entre reintentos (F-CB-3)', () => {
  it('backoff aplicado y registrado por el programador', async () => {
    const prog = new ProgramadorEsperaGrabado();
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry, programadorEspera: prog });
    expect(r.evidenciaOperativa.intento).toBe(4);
    expect(prog.esperas).toEqual([100, 100, 100]); // 3 esperas entre 4 intentos
    expect(r.evidenciaOperativa.backoffAplicadoMs).toBe(300);
  });

  it('revocación durante backoff → detiene con CICLO_VIDA (no intento siguiente)', async () => {
    let n = 0;
    const recargar = async () => { n += 1; return reg(n >= 1 ? { estado: 'REVOCADO', revocadoMotivo: 'x' } : {}); };
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry, programadorEspera: new ProgramadorEsperaGrabado(), recargarRegistro: recargar });
    expect(r.evidenciaOperativa.gateReevaluado).toBe('CICLO_VIDA');
    expect(r.evidenciaOperativa.intento).toBe(2);
    expect(r.resultado).toBeNull();
  });

  it('expiración durante backoff → detiene (instante avanza más allá de expiraEn)', async () => {
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg({ expiraEn: '2026-08-02T00:00:05.000Z' }), {
      observadoEn: O, politicaBreaker, politicaRetry,
      programadorEspera: new ProgramadorEsperaGrabado(),
      relojIntento: (i) => isoSumarMs(O, i === 1 ? 0 : 10_000), // intento 2 ya pasó expiraEn
    });
    expect(r.evidenciaOperativa.gateReevaluado).toBe('CICLO_VIDA');
    expect(r.evidenciaOperativa.intento).toBe(2);
  });

  it('cancelación durante backoff → CANCELACION', async () => {
    const c = new AbortController();
    const prog: ProgramadorEspera = { async esperar() { c.abort('cancel'); } };
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry, programadorEspera: prog, signal: c.signal });
    expect(r.evidenciaOperativa.gateReevaluado).toBe('CANCELACION');
  });

  it('descriptor incompatible durante retry → INTEGRIDAD', async () => {
    const descOtra = crearDescriptor({ adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '9.9.9', evidenciaSchemaVersion: '1', capacidades: { soportaSimulado: true, soportaReal: false, soportaHealthCheck: true, soportaCancelacion: true, soportaTimeout: false } }, 2);
    const recargar = async () => reg({ descriptor: descOtra }); // instancia versión 1.0.0 ≠ descriptor 9.9.9
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry, programadorEspera: new ProgramadorEsperaGrabado(), recargarRegistro: recargar });
    expect(r.evidenciaOperativa.gateReevaluado).toBe('INTEGRIDAD');
  });

  it('breaker se abre durante retry → BREAKER', async () => {
    const recargar = async () => reg({ circuitBreaker: { estado: 'ABIERTO', fallosConsecutivos: 3, abiertoDesde: O } });
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry, programadorEspera: new ProgramadorEsperaGrabado(), recargarRegistro: recargar });
    expect(r.evidenciaOperativa.gateReevaluado).toBe('BREAKER');
  });

  it('salud pasa a NO_CONFIABLE durante retry → SALUD', async () => {
    const recargar = async () => reg({ salud: 'NO_CONFIABLE' });
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry, programadorEspera: new ProgramadorEsperaGrabado(), recargarRegistro: recargar });
    expect(r.evidenciaOperativa.gateReevaluado).toBe('SALUD');
  });
});

describe('@soec/adaptadores · lease SEMIABIERTO (F-CB-4)', () => {
  const semiabierto = () => reg({ circuitBreaker: { estado: 'ABIERTO', fallosConsecutivos: 3, abiertoDesde: O } });
  const instante31 = '2026-08-02T00:00:31.000Z'; // pasó la reapertura → SEMIABIERTO

  it('en SEMIABIERTO adquiere lease y lo libera al terminar', async () => {
    const coord = new CoordinadorSemiabierto();
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), semiabierto(), { observadoEn: instante31, politicaBreaker, coordinadorSemiabierto: coord, relojIntento: () => instante31 });
    expect(r.evidenciaOperativa.leaseSemiabierto).toBe(true);
    expect(coord.vigente('org-a', 'gen-1', instante31)).toBe(false); // liberado en finally
  });

  it('un segundo intento concurrente en SEMIABIERTO → NO_DISPONIBLE', async () => {
    const coord = new CoordinadorSemiabierto();
    coord.intentarAdquirir('org-a', 'gen-1', 'otro-lease', instante31, isoSumarMs(instante31, 30000)); // prueba en curso
    const r = await orq.orquestar(fallaReintentable(), ctx(), solicitud, cap(), semiabierto(), { observadoEn: instante31, politicaBreaker, coordinadorSemiabierto: coord, relojIntento: () => instante31 });
    expect(r.evidenciaOperativa.gateRechazo).toBe('SEMIABIERTO');
    expect(r.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
  });

  it('coordinador: único lease, segundo rechazado, liberación idempotente, expiración recuperable, aislamiento por org', () => {
    const coord = new CoordinadorSemiabierto();
    const a = coord.intentarAdquirir('org-a', 'gen-1', 'L1', O, isoSumarMs(O, 30000));
    expect(a.ok).toBe(true);
    expect(coord.intentarAdquirir('org-a', 'gen-1', 'L2', O, isoSumarMs(O, 30000)).ok).toBe(false);
    // otra organización no comparte lease
    expect(coord.intentarAdquirir('org-b', 'gen-1', 'L3', O, isoSumarMs(O, 30000)).ok).toBe(true);
    if (a.ok) {
      coord.liberar(a.lease);
      coord.liberar(a.lease); // idempotente
    }
    expect(coord.intentarAdquirir('org-a', 'gen-1', 'L4', O, isoSumarMs(O, 30000)).ok).toBe(true);
    // lease expirado es recuperable
    const exp = coord.intentarAdquirir('org-a', 'gen-2', 'L5', O, isoSumarMs(O, 10));
    expect(exp.ok).toBe(true);
    expect(coord.intentarAdquirir('org-a', 'gen-2', 'L6', isoSumarMs(O, 20), isoSumarMs(O, 40)).ok).toBe(true); // el anterior ya expiró
  });
});
