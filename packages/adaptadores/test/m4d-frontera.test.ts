/**
 * @soec/adaptadores · M4-D (neutral) · frontera de ejecución independiente de D-1..D-7: ledger de consumo,
 * niveles de activación, gate de presupuesto en el orquestador y template de adaptador real + fake (secreto
 * por referencia + egress). Adversarial. Sin red/SDK/proveedor/secreto real.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import { SecretStoreEnMemoria } from '@soec/secretos';
import {
  AdaptadorRealBase,
  AdaptadorRealFake,
  type EsquemaSalida,
  OrquestadorAdaptadores,
  RegistroAdaptadoresService,
  RegistroConsumo,
  TransicionAdaptadorInvalidaError,
  CIRCUIT_BREAKER_CERRADO,
  type RegistroAdaptador,
  auditarNoFiltracion,
  crearDescriptor,
  estimarConservador,
  nivelPermiteModo,
  nivelPermiteReal,
  transicionActivacionValida,
  validarEgress,
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
    expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: descReal, nivelActivacion: 'REAL', creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4,
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
  it('nivel de activación SANDBOX bloquea REAL (ACTIVACION); PILOTO lo permite', async () => {
    const rSandbox = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL', nivelActivacion: 'SANDBOX' });
    expect(rSandbox.evidenciaOperativa.gateRechazo).toBe('ACTIVACION');
    expect(rSandbox.resultado).toBeNull();
    const rPiloto = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), { observadoEn: O, politicaBreaker, modoSolicitado: 'REAL', nivelActivacion: 'PILOTO' });
    expect(rPiloto.resultado?.estado).toBe('OK');
  });
  it('nivel de activación no afecta a SIMULADO', async () => {
    const r = await orq.orquestar(adaptador, ctx(), sol, cap(), reg(), { observadoEn: O, politicaBreaker, nivelActivacion: 'SIMULADO' });
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

  it('NO-FILTRACIÓN por el path COMPLETO del orquestador (resultado + ambas evidencias)', async () => {
    const store = new SecretStoreEnMemoria({ 'env:GEN': SECRETO });
    const ad = new AdaptadorRealFake({ secretStore: store, secretRef: 'env:GEN', esquemaEgress: esquema });
    const cap = (): CapacidadState => ({ organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'SIMULADA', salud: 'SALUDABLE', politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false });
    const reg = (): RegistroAdaptador => ({ organizationId: 'org-a', adaptadorId: 'real-fake', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '0.0.0', estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO, expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: null, nivelActivacion: 'SIMULADO', creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4 });
    const r = await new OrquestadorAdaptadores().orquestar(ad, ctx(), { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: { tema: 'agua', rut: '11.111' } } }, cap(), reg(), { observadoEn: O, politicaBreaker: { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' } });
    expect(r.resultado?.estado).toBe('OK');
    expect(auditarNoFiltracion(SECRETO, { resultado: r.resultado, evOperativa: r.evidenciaOperativa, evSandbox: r.evidenciaSandbox }).filtra).toBe(false);
  });

  it('egress rechaza valores no primitivos y respeta límites/omisiones (completitud adversarial)', () => {
    // objeto/array como valor de campo declarado → rechazado (default-deny de tipos complejos)
    const esq: EsquemaSalida = { operacion: 'x', campos: [{ nombre: 'a', tipo: 'string' }] };
    const r = validarEgress(esq, { a: { anidado: 1 } as unknown as string });
    expect(r.rechazados).toContain('a');
    expect(r.datos.a).toBeUndefined();
  });
});

describe('@soec/adaptadores · nivel de activación event-sourced (servicio)', () => {
  const attr: Attribution = { source: 'pce', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
  const o = OrganizationId('org-a');
  const c: RequestContext = { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
  async function autorizado(store = new InMemoryEventStore()) {
    const s = new RegistroAdaptadoresService(store);
    await s.registrar(c, 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    await s.configurar(c, 'gen-1', { compatibilidad: { contratoId: 'gen', versionesContratoSoportadas: ['1.0.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' }, limites: { maxConcurrentesPorOrganizacion: 1, maxConcurrentesPorAdaptador: 1, maxConcurrentesPorCapacidad: 1, version: '1' } }, 'ana', attr, O);
    return s;
  }

  it('nace SIMULADO; avanza un paso y retrocede a SIMULADO (kill-switch); replay conserva', async () => {
    const store = new InMemoryEventStore();
    const s = await autorizado(store);
    expect((await s.cargar(c, 'gen-1')).nivelActivacion).toBe('SIMULADO');
    await s.cambiarNivel(c, 'gen-1', 'SANDBOX', 'ana-humana', attr, O);
    expect((await s.cambiarNivel(c, 'gen-1', 'PILOTO', 'ana-humana', attr, O)).nivelActivacion).toBe('PILOTO');
    await s.cambiarNivel(c, 'gen-1', 'SIMULADO', 'ana-humana', attr, O); // kill-switch
    expect((await s.cargar(c, 'gen-1')).nivelActivacion).toBe('SIMULADO');
  });

  it('rechaza saltos (SIMULADO→PILOTO) y exige actor humano', async () => {
    const s = await autorizado();
    await expect(s.cambiarNivel(c, 'gen-1', 'PILOTO', 'ana-humana', attr, O)).rejects.toBeInstanceOf(TransicionAdaptadorInvalidaError);
    await expect(s.cambiarNivel(c, 'gen-1', 'SANDBOX', '', attr, O)).rejects.toThrow();
  });
});

describe('@soec/adaptadores · registro de consumo tras ejecución REAL', () => {
  it('contabiliza el consumo estimado en la ventana tras una ejecución REAL exitosa', async () => {
    const cap = (): CapacidadState => ({ organizationId: 'org-a', capacidadId: 'gen', tipo: 'g', version: 5, existe: true, estado: 'EN_USO', modo: 'REAL', salud: 'SALUDABLE', politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:GEN', alternativaCapacidadId: null, cacheRef: null, configVersion: 3, reemplazadaPor: null, terminada: false });
    const descReal = crearDescriptor({ adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1', capacidades: { soportaSimulado: true, soportaReal: true, soportaHealthCheck: true, soportaCancelacion: true, soportaTimeout: true } }, 1);
    const reg = (): RegistroAdaptador => ({ organizationId: 'org-a', adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0', estado: 'AUTORIZADO', modo: 'REAL', secretRef: 'env:GEN', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO, expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: descReal, nivelActivacion: 'REAL', creadoPor: 'ana', actualizadoPor: 'ana-h', existe: true, terminada: false, version: 4 });
    const adaptador = { nombre: 'gen-1', capacidad: 'gen', version: '1.0.0', soportaReal: () => true, async salud() { return { estado: 'SALUDABLE' as const, detalle: '' }; }, async ejecutar() { return { estado: 'OK' as const, salida: { k: 'v' }, error: null }; } };
    const consumo = new RegistroConsumo();
    const r = await new OrquestadorAdaptadores().orquestar(adaptador, ctx(), { solicitudId: 's', capacidadId: 'gen', peticion: { operacion: 'generar', parametros: {} } }, cap(), reg(), {
      observadoEn: O, politicaBreaker: { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' }, modoSolicitado: 'REAL',
      presupuesto: { politica: { topeUnidades: 100, ventanaMs: 60000, version: '1' }, consumidoEnVentana: 0, estimacion: estimarConservador(7, null) }, registroConsumo: consumo,
    });
    expect(r.resultado?.estado).toBe('OK');
    expect(r.evidenciaOperativa.nivelActivacion).toBe('REAL');
    expect(consumo.consumidoEnVentana('org-a', 'gen', O, 60000)).toBe(7); // registró lo estimado
  });
});
