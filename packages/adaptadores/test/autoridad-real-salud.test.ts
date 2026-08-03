/**
 * @soec/adaptadores · M4-C-B-H · F-CB-1 (autoridad única del modo REAL, derivada del registro + adaptador)
 * y F-CB-2 (health fail-closed). El llamador sólo pide una intención; jamás autoriza REAL. Un resultado de
 * health inválido nunca se degrada a saludable.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  type AdaptadorExterno,
  type HealthCheckAdaptador,
  type RegistroAdaptador,
  type SalidaAdaptador,
  OrquestadorAdaptadores,
  CIRCUIT_BREAKER_CERRADO,
  autoridadModoReal,
  derivarEstadoFrontera,
  validarCoherenciaFrontera,
  crearDescriptor,
} from '../src/index';

const descReal = crearDescriptor(
  { adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1', capacidades: { soportaSimulado: true, soportaReal: true, soportaHealthCheck: true, soportaCancelacion: true, soportaTimeout: true } },
  1,
);

const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('s'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'req-1' };
};
const solicitud = { solicitudId: 'sol-1', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: { a: '1' } } };
const cap = (): CapacidadState => ({
  organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'REAL', salud: 'SALUDABLE',
  politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false,
});
const compat = { contratoId: 'gen', versionesContratoSoportadas: ['1.0.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' };
const limite = { maxConcurrentesPorOrganizacion: 4, maxConcurrentesPorAdaptador: 1, maxConcurrentesPorCapacidad: 4, version: '1' };
const politicaBreaker = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' };
const reg = (over: Partial<RegistroAdaptador> = {}): RegistroAdaptador => ({
  organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0',
  estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: compat, limites: limite, circuitBreaker: CIRCUIT_BREAKER_CERRADO,
  expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: null, creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4, ...over,
});
const ok: SalidaAdaptador = { estado: 'OK', salida: { k: 'v' }, error: null };
const adaptador = (soporta: boolean): AdaptadorExterno & { ejecutado: () => boolean } => {
  let ejec = false;
  return {
    nombre: 'gen-1', capacidad: 'gen', version: '1.0.0',
    soportaReal: () => soporta,
    async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
    async ejecutar() { ejec = true; return ok; },
    ejecutado: () => ejec,
  };
};
const orq = new OrquestadorAdaptadores();

describe('@soec/adaptadores · F-CB-1 autoridad del modo REAL', () => {
  it('intención REAL + registro SIMULADO → NO_AUTORIZADO, sin ejecutar', async () => {
    const ad = adaptador(true);
    const r = await orq.orquestar(ad, ctx(), solicitud, cap(), reg({ modo: 'SIMULADO' }), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL' });
    expect(r.resultado).toBeNull();
    expect(r.evidenciaOperativa.codigoError).toBe('NO_AUTORIZADO');
    expect(r.evidenciaOperativa.gateRechazo).toBe('MODO_REAL');
    expect(ad.ejecutado()).toBe(false);
  });

  it('registro REAL/AUTORIZADO + descriptor sin soportaReal → NO_AUTORIZADO', async () => {
    const ad = adaptador(false);
    const r = await orq.orquestar(ad, ctx(), solicitud, cap(), reg({ modo: 'REAL' }), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL' });
    expect(r.evidenciaOperativa.gateRechazo).toBe('MODO_REAL');
    expect(ad.ejecutado()).toBe(false);
  });

  it('registro REAL sin secretRef → NO_AUTORIZADO', async () => {
    const r = await orq.orquestar(adaptador(true), ctx(), solicitud, cap(), reg({ modo: 'REAL', secretRef: null, descriptor: descReal }), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL' });
    expect(r.evidenciaOperativa.gateRechazo).toBe('MODO_REAL');
  });

  it('registro REAL/AUTORIZADO + descriptor soportaReal=true + gates completos → llega al sandbox en REAL', async () => {
    const ad = adaptador(true);
    const r = await orq.orquestar(ad, ctx(), solicitud, cap(), reg({ modo: 'REAL', descriptor: descReal }), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL' });
    expect(r.resultado?.estado).toBe('OK');
    expect(r.resultado?.modoEjecutado).toBe('REAL');
    expect(r.evidenciaOperativa.modoAutorizado).toBe('REAL');
    expect(ad.ejecutado()).toBe(true);
  });

  it('el rechazo REAL ocurre ANTES de concurrencia (no consume permiso)', async () => {
    const { LimitadorConcurrencia } = await import('../src/index');
    const limitador = new LimitadorConcurrencia();
    await orq.orquestar(adaptador(true), ctx(), solicitud, cap(), reg({ modo: 'SIMULADO' }), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL', limite, limitador });
    expect(limitador.enCursoOrg('org-a')).toBe(0);
  });

  it('helper autoridadModoReal usa el descriptor (no la instancia) y coherencia de frontera', () => {
    const ad = adaptador(true);
    expect(autoridadModoReal(reg({ modo: 'SIMULADO' }), 'REAL').ok).toBe(false);
    expect(autoridadModoReal(reg({ modo: 'REAL' }), 'REAL').ok).toBe(false); // sin descriptor → rechazo
    expect(autoridadModoReal(reg({ modo: 'REAL', descriptor: descReal }), 'REAL')).toEqual({ ok: true, modoEjecutado: 'REAL', motivo: '' });
    const front = derivarEstadoFrontera(reg({ modo: 'REAL' }));
    expect(front).toEqual({ activacion: 'ACTIVADO', modo: 'REAL', credencial: 'CON_CREDENCIAL', consumo: 'CONSUMIBLE', secretRef: 'env:GEN' });
    expect(validarCoherenciaFrontera(reg({ modo: 'SIMULADO' }), front, ad).coherente).toBe(false);
  });
});

describe('@soec/adaptadores · F-CB-2 health fail-closed', () => {
  const health = (r: unknown): HealthCheckAdaptador => ({ nombre: 'x', async comprobar() { return r as never; } });

  it('estado inventado → NO_DISPONIBLE (no saludable por defecto)', async () => {
    const r = await orq.orquestar(adaptador(false), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, healthCheck: health({ estado: 'INVENTADO', codigo: 'x', observadoEn: O, evidenciaVersion: '1' }) });
    expect(r.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
    expect(r.evidenciaOperativa.gateRechazo).toBe('SALUD');
  });

  it('codigo vacío / observadoEn inválido / evidenciaVersion incompatible → NO_DISPONIBLE', async () => {
    for (const bad of [
      { estado: 'SALUDABLE', codigo: '', observadoEn: O, evidenciaVersion: '1' },
      { estado: 'SALUDABLE', codigo: 'ok', observadoEn: 'no-iso', evidenciaVersion: '1' },
      { estado: 'SALUDABLE', codigo: 'ok', observadoEn: O, evidenciaVersion: '9' },
      null,
    ]) {
      const r = await orq.orquestar(adaptador(false), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, healthCheck: health(bad) });
      expect(r.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
    }
  });

  it('health check que lanza error sensible → NO_DISPONIBLE sin fuga', async () => {
    const health2: HealthCheckAdaptador = { nombre: 'x', async comprobar() { throw new Error('SENTINELA-SECRETA'); } };
    const r = await orq.orquestar(adaptador(false), ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, healthCheck: health2 });
    expect(r.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
    expect(JSON.stringify(r)).not.toContain('SENTINELA-SECRETA');
  });

  it('SALUDABLE válido → continúa; NO_CONFIABLE válido → bloqueo', async () => {
    const ad = adaptador(false);
    const okR = await orq.orquestar(ad, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, healthCheck: health({ estado: 'SALUDABLE', codigo: 'ok', observadoEn: O, evidenciaVersion: '1' }) });
    expect(okR.resultado?.estado).toBe('OK');
    const noR = await orq.orquestar(ad, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, healthCheck: health({ estado: 'NO_CONFIABLE', codigo: 'down', observadoEn: O, evidenciaVersion: '1' }) });
    expect(noR.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
  });
});
