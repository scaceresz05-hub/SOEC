/**
 * @soec/adaptadores · M4-D (neutral) · andamiaje independiente de D-1..D-7. Tests adversariales de: sellado
 * de instancia (F-CCC-1), política de salida de datos (egress default-deny), minimización, presupuesto
 * antes de la llamada y harness de no-filtración. Todo determinista, sin red/SDK/proveedor real.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  type AdaptadorExterno,
  OrquestadorAdaptadores,
  CIRCUIT_BREAKER_CERRADO,
  type RegistroAdaptador,
  auditarNoFiltracion,
  estimarConservador,
  evaluarPresupuesto,
  sellarAdaptador,
  transformar,
  validarEgress,
} from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('s'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'req-1' };
};

// ── F-CCC-1: sellado de instancia ──
describe('@soec/adaptadores · sellado de instancia (F-CCC-1)', () => {
  const base = (): AdaptadorExterno & { ejecutado: () => boolean } => {
    let ejec = false;
    return {
      nombre: 'gen-1', capacidad: 'gen', version: '1.0.0',
      soportaReal: () => false,
      async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
      async ejecutar() { ejec = true; return { estado: 'OK', salida: { k: 'v' }, error: null }; },
      ejecutado: () => ejec,
    };
  };

  it('devuelve un adaptador congelado con identidad capturada', () => {
    const s = sellarAdaptador(base());
    expect(Object.isFrozen(s)).toBe(true);
    expect([s.nombre, s.capacidad, s.version]).toEqual(['gen-1', 'gen', '1.0.0']);
    expect(s.soportaReal?.()).toBe(false);
  });

  it('un monkey-patch de la instancia ORIGINAL tras sellar NO cambia el comportamiento sellado', async () => {
    const original = base();
    const sellado = sellarAdaptador(original);
    // Ataque: reemplazar métodos/identidad del original después de sellar.
    (original as unknown as { ejecutar: () => Promise<unknown> }).ejecutar = async () => ({ estado: 'OK', salida: { hackeado: 'sí' }, error: null });
    (original as unknown as { soportaReal: () => boolean }).soportaReal = () => true;
    (original as unknown as { version: string }).version = '9.9.9';
    const r = await sellado.ejecutar(ctx(), { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: {} } });
    expect(r.salida).toEqual({ k: 'v' }); // el sellado ejecuta el método capturado, no el hackeado
    expect(sellado.soportaReal?.()).toBe(false); // captura previa
    expect(sellado.version).toBe('1.0.0');
  });

  it('no es mutable: reasignar métodos del sellado lanza (congelado)', () => {
    const s = sellarAdaptador(base());
    expect(() => {
      (s as unknown as { ejecutar: unknown }).ejecutar = async () => ({});
    }).toThrow();
  });
});

// ── Egress: lista blanca cerrada default-deny ──
describe('@soec/adaptadores · egress (default-deny, tipado)', () => {
  const esquema = {
    operacion: 'consultar',
    campos: [
      { nombre: 'rut', tipo: 'string' as const, transformacion: 'SEUDONIMIZAR' as const, opciones: { clave: 'k' } },
      { nombre: 'monto', tipo: 'number' as const },
      { nombre: 'nota', tipo: 'string' as const, transformacion: 'TRUNCAR' as const, opciones: { longitud: 3 } },
    ],
  };

  it('sólo salen los campos declarados; lo no declarado se descarta', () => {
    const r = validarEgress(esquema, { rut: '11.111', monto: 500, nota: 'confidencial', documentoCompleto: 'PDF...', otroTenant: 'x' });
    expect(Object.keys(r.datos).sort()).toEqual(['monto', 'nota', 'rut']);
    expect(r.descartados).toEqual(['documentoCompleto', 'otroTenant']);
    expect(r.datos.rut).toMatch(/^seud_/); // seudonimizado, no en claro
    expect(r.datos.rut).not.toContain('11.111');
    expect(r.datos.nota).toBe('con'); // truncado
    expect(r.permitido).toBe(true);
  });

  it('un campo declarado con tipo inválido se rechaza y no sale', () => {
    const r = validarEgress(esquema, { monto: 'no-es-numero' });
    expect(r.rechazados).toContain('monto');
    expect(r.datos.monto).toBeUndefined();
    expect(r.permitido).toBe(false);
  });

  it('seudonimización sin clave → el campo se OMITE (fail-closed), no sale en claro', () => {
    const esq = { operacion: 'x', campos: [{ nombre: 'rut', tipo: 'string' as const, transformacion: 'SEUDONIMIZAR' as const }] };
    const r = validarEgress(esq, { rut: '11.111' });
    expect(r.datos.rut).toBeUndefined();
  });
});

describe('@soec/adaptadores · minimización', () => {
  it('transformaciones deterministas', () => {
    expect(transformar('IDENTIDAD', 'x')).toBe('x');
    expect(transformar('REDACTAR', 'secreto')).toBe('[REDACTADO]');
    expect(transformar('TRUNCAR', 'abcdef', { longitud: 2 })).toBe('ab');
    expect(transformar('OMITIR', 'x')).toBeNull();
    expect(transformar('SEUDONIMIZAR', 'x', { clave: 'k' })).toBe(transformar('SEUDONIMIZAR', 'x', { clave: 'k' })); // estable
    expect(transformar('SEUDONIMIZAR', 'x', { clave: 'k1' })).not.toBe(transformar('SEUDONIMIZAR', 'x', { clave: 'k2' })); // depende de la clave
    expect(transformar('SEUDONIMIZAR', 'x')).toBeNull(); // sin clave → fail-closed
  });
});

// ── Presupuesto antes de la llamada ──
describe('@soec/adaptadores · presupuesto (antes de la llamada)', () => {
  const politica = { topeUnidades: 100, ventanaMs: 60000, version: '1' };

  it('permite si consumido + estimación no supera el tope', () => {
    expect(evaluarPresupuesto(politica, 80, estimarConservador(10, null)).permitido).toBe(true);
  });
  it('en el límite exacto (proyectado == tope) permite; superarlo por 1 rechaza', () => {
    expect(evaluarPresupuesto(politica, 90, estimarConservador(10, null)).permitido).toBe(true); // ==100
    expect(evaluarPresupuesto(politica, 90, estimarConservador(11, null)).permitido).toBe(false); // 101
  });
  it('rechaza ANTES de la llamada si superaría el tope', () => {
    expect(evaluarPresupuesto(politica, 95, estimarConservador(10, null)).permitido).toBe(false);
  });
  it('costo desconocido → estimación conservadora por cota superior', () => {
    const e = estimarConservador(null, 30);
    expect(e).toEqual({ unidades: 30, naturaleza: 'CONSERVADORA' });
  });
  it('sin exacto ni cota → DESCONOCIDA → rechazo (fail-safe a no-gasto)', () => {
    const e = estimarConservador(null, null);
    expect(e.naturaleza).toBe('DESCONOCIDA');
    expect(evaluarPresupuesto(politica, 0, e).permitido).toBe(false);
  });
});

// ── Harness de no-filtración ──
describe('@soec/adaptadores · harness de no-filtración', () => {
  const SENT = 'ZZ-SENTINELA-SINTETICA';
  it('detecta fuga en cualquier superficie (incluido stack de error)', () => {
    const r = auditarNoFiltracion(SENT, { resultado: { ok: true }, error: new Error(SENT), log: 'limpio' });
    expect(r.filtra).toBe(true);
    expect(r.superficiesFiltradas).toContain('error');
  });
  it('sin fuga → filtra=false', () => {
    const r = auditarNoFiltracion(SENT, { resultado: { ok: true }, evidencia: { a: 1 } });
    expect(r.filtra).toBe(false);
  });
});

// ── Integración: F-CCC-1 vía orquestador (regresión: sigue funcionando en SIMULADO) ──
describe('@soec/adaptadores · orquestador sella la instancia (integración)', () => {
  const cap = (): CapacidadState => ({
    organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'SIMULADA', salud: 'SALUDABLE',
    politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false,
  });
  const reg = (): RegistroAdaptador => ({
    organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0',
    estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO,
    expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: null, nivelActivacion: 'SIMULADO', creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4,
  });

  it('ejecución SIMULADA normal + monkey-patch del original tras entrar no altera el resultado', async () => {
    const original: AdaptadorExterno = {
      nombre: 'gen-1', capacidad: 'gen', version: '1.0.0',
      async salud() { return { estado: 'SALUDABLE', detalle: '' }; },
      async ejecutar() { return { estado: 'OK', salida: { titulo: 'Hola' }, error: null }; },
    };
    const p = new OrquestadorAdaptadores().orquestar(original, ctx(), { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: {} } }, cap(), reg(), { observadoEn: O, politicaBreaker: { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' } });
    (original as unknown as { ejecutar: () => Promise<unknown> }).ejecutar = async () => ({ estado: 'OK', salida: { hackeado: 'sí' }, error: null });
    const r = await p;
    expect(r.resultado?.salida).toEqual({ titulo: 'Hola' });
  });
});
