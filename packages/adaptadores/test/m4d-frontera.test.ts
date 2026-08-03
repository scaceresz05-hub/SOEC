/**
 * @soec/adaptadores · M4-D (neutral) · frontera de ejecución independiente de D-1..D-7: ledger de consumo,
 * niveles de activación, gate de presupuesto en el orquestador y template de adaptador real + fake (secreto
 * por referencia + egress). Adversarial. Sin red/SDK/proveedor/secreto real.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import { SecretStoreEnMemoria } from '@soec/secretos';
import {
  AdaptadorRealBase,
  AdaptadorRealFake,
  type EsquemaSalida,
  OrquestadorAdaptadores,
  RegistroConsumo,
  CIRCUIT_BREAKER_CERRADO,
  type RegistroAdaptador,
  auditarNoFiltracion,
  crearDescriptor,
  estimarConservador,
  nivelPermiteModo,
  nivelPermiteReal,
  transicionActivacionValida,
} from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('s'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'req-1' };
};

describe('@soec/adaptadores · ledger de consumo', () => {
  it('suma sólo dentro de la ventana y aísla por org/capacidad', () => {
    const c = new RegistroConsumo();
    c.registrar('org-a', 'gen', 10, '2026-08-02T00:00:00.000Z');
    c.registrar('org-a', 'gen', 5, '2026-08-02T00:00:30.000Z'); // dentro de 60s
    c.registrar('org-a', 'gen', 7, '2026-08-02T00:02:00.000Z'); // fuera de la ventana (respecto de 00:00:40)
    expect(c.consumidoEnVentana('org-a', 'gen', '2026-08-02T00:00:40.000Z', 60000)).toBe(15);
    expect(c.consumidoEnVentana('org-b', 'gen', '2026-08-02T00:00:40.000Z', 60000)).toBe(0); // otra org
    expect(c.consumidoEnVentana('org-a', 'otra', '2026-08-02T00:00:40.000Z', 60000)).toBe(0); // otra capacidad
  });
  it('ignora magnitudes inválidas (fail-safe)', () => {
    const c = new RegistroConsumo();
    c.registrar('org-a', 'gen', Number.NaN, O);
    c.registrar('org-a', 'gen', -5, O);
    expect(c.consumidoEnVentana('org-a', 'gen', O, 60000)).toBe(0);
  });
});

describe('@soec/adaptadores · niveles de activación', () => {
  it('sólo avanza un paso; retrocede a SIMULADO desde cualquier nivel (kill-switch)', () => {
    expect(transicionActivacionValida('SIMULADO', 'SANDBOX')).toBe(true);
    expect(transicionActivacionValida('SIMULADO', 'PILOTO')).toBe(false); // salto
    expect(transicionActivacionValida('SANDBOX', 'PILOTO')).toBe(true);
    expect(transicionActivacionValida('REAL', 'SIMULADO')).toBe(true); // kill-switch
    expect(transicionActivacionValida('PILOTO', 'SIMULADO')).toBe(true);
  });
  it('sólo PILOTO/REAL permiten ejecución real', () => {
    expect(nivelPermiteReal('SIMULADO')).toBe(false);
    expect(nivelPermiteReal('SANDBOX')).toBe(false);
    expect(nivelPermiteReal('PILOTO')).toBe(true);
    expect(nivelPermiteModo('SANDBOX', 'REAL').ok).toBe(false);
    expect(nivelPermiteModo('SANDBOX', 'SIMULADO').ok).toBe(true);
    expect(nivelPermiteModo('REAL', 'REAL').ok).toBe(true);
  });
});

describe('@soec/adaptadores · gate de presupuesto en el orquestador (REAL)', () => {
  const cap = (): CapacidadState => ({
    organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'REAL', salud: 'SALUDABLE',
    politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false,
  });
  const descReal = crearDescriptor({ adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1', capacidades: { soportaSimulado: true, soportaReal: true, soportaHealthCheck: true, soportaCancelacion: true, soportaTimeout: true } }, 1);
  const reg = (): RegistroAdaptador => ({
    organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0',
    estado: 'AUTORIZADO', modo: 'REAL', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO,
    expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: descReal, creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4,
  });
  const adaptador = { nombre: 'gen-1', capacidad: 'gen', version: '1.0.0', soportaReal: () => true, async salud() { return { estado: 'SALUDABLE' as const, detalle: '' }; }, async ejecutar() { return { estado: 'OK' as const, salida: { k: 'v' }, error: null }; } };
  const politicaBreaker = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' };
  const sol = { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: {} } };
  const orq = new OrquestadorAdaptadores();

  it('REAL rechazado ANTES de ejecutar si el presupuesto se superaría', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), {
      observadoEn: O, politicaBreaker, modoSolicitado: 'REAL',
      presupuesto: { politica: { topeUnidades: 100, ventanaMs: 60000, version: '1' }, consumidoEnVentana: 95, estimacion: estimarConservador(10, null) },
    });
    expect(r.evidenciaOperativa.gateRechazo).toBe('PRESUPUESTO');
    expect(r.evidenciaOperativa.codigoError).toBe('LIMITE');
  });
  it('REAL rechazado si el costo es desconocido (fail-safe a no-gasto)', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), {
      observadoEn: O, politicaBreaker, modoSolicitado: 'REAL',
      presupuesto: { politica: { topeUnidades: 100, ventanaMs: 60000, version: '1' }, consumidoEnVentana: 0, estimacion: estimarConservador(null, null) },
    });
    expect(r.evidenciaOperativa.gateRechazo).toBe('PRESUPUESTO');
  });
  it('REAL permitido dentro de presupuesto', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), {
      observadoEn: O, politicaBreaker, modoSolicitado: 'REAL',
      presupuesto: { politica: { topeUnidades: 100, ventanaMs: 60000, version: '1' }, consumidoEnVentana: 10, estimacion: estimarConservador(5, null) },
    });
    expect(r.resultado?.estado).toBe('OK');
    expect(r.resultado?.modoEjecutado).toBe('REAL');
  });
  it('REAL sin política + exigirPresupuesto → fail-closed (NO_AUTORIZADO)', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL', exigirPresupuesto: true });
    expect(r.evidenciaOperativa.gateRechazo).toBe('PRESUPUESTO');
    expect(r.resultado).toBeNull();
  });
  it('REAL sin política y sin exigir → permitido (fundación: presupuesto opcional)', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL' });
    expect(r.resultado?.estado).toBe('OK');
  });
  it('el presupuesto NO aplica en SIMULADO (sin costo)', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), {
      observadoEn: O, politicaBreaker, // SIMULADO por defecto
      presupuesto: { politica: { topeUnidades: 1, ventanaMs: 60000, version: '1' }, consumidoEnVentana: 999, estimacion: estimarConservador(999, null) },
    });
    expect(r.resultado?.estado).toBe('OK'); // no rechazado por presupuesto
  });
});

describe('@soec/adaptadores · template de adaptador real + fake', () => {
  const esquema: EsquemaSalida = {
    operacion: 'generar',
    campos: [
      { nombre: 'tema', tipo: 'string' },
      { nombre: 'rut', tipo: 'string', transformacion: 'SEUDONIMIZAR', opciones: { clave: 'k' } },
    ],
  };
  const SECRETO = 'ZZ-SECRETO-SINTETICO-9f3a';

  it('aplica egress, resuelve el secreto por referencia y NO lo filtra en la salida', async () => {
    const store = new SecretStoreEnMemoria({ 'env:GEN': SECRETO });
    const ad = new AdaptadorRealFake({ secretStore: store, secretRef: 'env:GEN', esquemaEgress: esquema });
    const s = await ad.ejecutar(ctx(), { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: { tema: 'agua', rut: '11.111', documentoCompleto: 'PDF...' } } });
    expect(s.estado).toBe('OK');
    expect(s.salida?.credencialPresente).toBe('true'); // usó el secreto sin exponerlo
    expect(s.salida?.campos).toBe('rut,tema'); // sólo campos declarados; 'documentoCompleto' se descartó
    // no-filtración del secreto sintético en toda la salida
    expect(auditarNoFiltracion(SECRETO, { salida: s }).filtra).toBe(false);
  });

  it('el fake declara soportaReal=false (no puede promoverse a REAL)', () => {
    const ad = new AdaptadorRealFake({ secretStore: new SecretStoreEnMemoria({ 'env:GEN': SECRETO }), secretRef: 'env:GEN', esquemaEgress: esquema });
    expect(ad.soportaReal()).toBe(false);
    expect(ad).toBeInstanceOf(AdaptadorRealBase);
  });

  it('secretRef inválida → error normalizado sin fuga', async () => {
    const store = new SecretStoreEnMemoria({});
    const ad = new AdaptadorRealFake({ secretStore: store, secretRef: 'env:NO_EXISTE', esquemaEgress: esquema });
    const s = await ad.ejecutar(ctx(), { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: { tema: 'x' } } });
    expect(s.estado).toBe('ERROR');
    expect(auditarNoFiltracion(SECRETO, { salida: s }).filtra).toBe(false);
  });
});
