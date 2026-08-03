/**
 * @soec/adaptadores · M4-C-B · orquestador operativo. Compone estado/compatibilidad/salud/breaker/
 * concurrencia/retry → sandbox → evidencia operativa. Pruebas adversariales de cada gate.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  AdaptadorFake,
  LimitadorConcurrencia,
  OrquestadorAdaptadores,
  type RegistroAdaptador,
  CIRCUIT_BREAKER_CERRADO,
  evaluarSmokeReal,
  SMOKE_REAL_BLOQUEADO,
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
const compat = { contratoId: 'gen', versionesContratoSoportadas: ['1.0.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' };
const politicaBreaker = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' };
const limite = { maxConcurrentesPorOrganizacion: 4, maxConcurrentesPorAdaptador: 1, maxConcurrentesPorCapacidad: 4, version: '1' };

const reg = (over: Partial<RegistroAdaptador> = {}): RegistroAdaptador => ({
  organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0',
  estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: compat, limites: limite, circuitBreaker: CIRCUIT_BREAKER_CERRADO,
  expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: null, creadoPor: 'ana', actualizadoPor: 'ana-humana', existe: true, terminada: false, version: 4, ...over,
});

const orq = new OrquestadorAdaptadores();
const fake = new AdaptadorFake({ capacidad: 'gen', version: '1.0.0', respuestas: { generar: { titulo: 'Hola' } } });

describe('@soec/adaptadores · orquestador (composición)', () => {
  it('cadena feliz: AUTORIZADO + compatible + saludable → OK + evidencia operativa', async () => {
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, compatSolicitada: { contratoId: 'gen', contratoVersion: '1.0.0', evidenciaSchemaVersion: '1' } });
    expect(r.resultado?.estado).toBe('OK');
    expect(r.evidenciaOperativa.organizationId).toBe('org-a');
    expect(r.evidenciaOperativa.evidenciaVersion).toBe(2);
    expect(r.evidenciaOperativa.naturalezaDuracion).toBe('SIMULADA');
    expect(Object.isFrozen(r.evidenciaOperativa)).toBe(true);
  });

  it('revocado → rechazo sin ejecutar (resultado null)', async () => {
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg({ estado: 'REVOCADO', revocadoMotivo: 'x' }), { observadoEn: O, politicaBreaker });
    expect(r.resultado).toBeNull();
    expect(r.evidenciaOperativa.codigoError).toBe('NO_AUTORIZADO');
  });

  it('expirado (por expiraEn pasado) → rechazo', async () => {
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg({ expiraEn: '2026-08-01T00:00:00.000Z' }), { observadoEn: O, politicaBreaker });
    expect(r.resultado).toBeNull();
  });

  it('incompatible → rechazo INVALIDO', async () => {
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, compatSolicitada: { contratoId: 'gen', contratoVersion: '2.0.0', evidenciaSchemaVersion: '1' } });
    expect(r.evidenciaOperativa.codigoError).toBe('INVALIDO');
  });

  it('salud NO_CONFIABLE (registro) → NO_DISPONIBLE', async () => {
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg({ salud: 'NO_CONFIABLE' }), { observadoEn: O, politicaBreaker });
    expect(r.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
  });

  it('circuit breaker ABIERTO reciente → NO_DISPONIBLE', async () => {
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg({ circuitBreaker: { estado: 'ABIERTO', fallosConsecutivos: 3, abiertoDesde: O } }), { observadoEn: O, politicaBreaker });
    expect(r.evidenciaOperativa.codigoError).toBe('NO_DISPONIBLE');
  });

  it('límite de concurrencia alcanzado → LIMITE', async () => {
    const limitador = new LimitadorConcurrencia();
    limitador.adquirir('org-a', 'gen-1', 'gen', limite); // ocupa el único permiso por adaptador
    const r = await orq.orquestar(fake, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, limite, limitador });
    expect(r.evidenciaOperativa.codigoError).toBe('LIMITE');
    expect(r.evidenciaOperativa.limiteAlcanzado).toBe(true);
  });

  it('libera el permiso de concurrencia tras ejecutar', async () => {
    const limitador = new LimitadorConcurrencia();
    await orq.orquestar(fake, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, limite, limitador });
    expect(limitador.enCursoOrg('org-a')).toBe(0);
  });

  it('retry gobernado: reintenta un error reintentable y traza el intento', async () => {
    const fallaSiempre = new AdaptadorFake({ capacidad: 'gen', version: '1.0.0', errorForzado: { clase: 'NO_DISPONIBLE', mensaje: 'x', reintentable: true } });
    const politicaRetry = { habilitado: true, maxIntentos: 3, erroresReintentables: ['NO_DISPONIBLE'] as const, backoff: 'FIJO' as const, baseMs: 0, jitter: false as const, version: '1' };
    const r = await orq.orquestar(fallaSiempre, ctx(), solicitud, cap(), reg(), { observadoEn: O, politicaBreaker, politicaRetry });
    expect(r.evidenciaOperativa.intento).toBe(3);
    expect(r.evidenciaOperativa.retryAplicado).toBe(true);
  });

  it('aísla por organización (Org B no consume registro de A)', async () => {
    const r = await orq.orquestar(fake, ctx('org-b'), solicitud, cap(), reg({ organizationId: 'org-a' }), { observadoEn: O, politicaBreaker });
    // El sandbox valida tenant: cap org-a con ctx org-b → NO_AUTORIZADO.
    expect(r.resultado?.error?.clase ?? r.evidenciaOperativa.codigoError).toBe('NO_AUTORIZADO');
  });
});

describe('@soec/adaptadores · smoke real bloqueado', () => {
  it('default deshabilitado → rechazo', () => {
    expect(evaluarSmokeReal(SMOKE_REAL_BLOQUEADO).permitido).toBe(false);
  });
  it('aún con todo presente, M4-C-B lo bloquea', () => {
    expect(evaluarSmokeReal({ habilitado: true, confirmacionHumana: 'sí', organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen' }).permitido).toBe(false);
  });
});
