/**
 * @soec/cia · tests · INVARIANTES DE PRODUCTO del Centro de Integraciones Autónomas.
 *
 * Prueban lo que el bloque promete, no lo que uno espera: el usuario autoriza capacidades (no herramientas);
 * el proveedor nunca se filtra a la vista; sustituir el proveedor no cambia la experiencia; el kill-switch y el
 * límite frenan de verdad; el nivel de autonomía decide aprobación vs. automático; el modo REAL está bloqueado.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_MARKETING, todosLosProveedoresRef, verificarSinFugaDeProveedor, AUTONOMOUS_REAL, ModoRealBloqueadoError,
  CapacidadDesconocidaError, ComandoCiaInvalidoError, decidirPlan, estadoInicialAutorizacion,
} from '../src/index';
import { InMemoryEventStore, montar, ctx, attr, O, HUMANO } from './_setup';

const NOMBRES_COMERCIALES = ['meta', 'facebook', 'google', 'instagram', 'tiktok', 'linkedin', 'mailchimp', 'hubspot', 'whatsapp'];

describe('CIA · catálogo neutral (resultados, no herramientas)', () => {
  it('ningún texto de cara al usuario nombra una herramienta comercial', () => {
    for (const c of CATALOGO_MARKETING) {
      const visible = `${c.titulo} ${c.descripcion}`.toLowerCase();
      for (const marca of NOMBRES_COMERCIALES) expect(visible.includes(marca)).toBe(false);
    }
  });
  it('cada capacidad expone un resultado y esconde sus proveedores candidatos', () => {
    for (const c of CATALOGO_MARKETING) {
      expect(c.titulo.length).toBeGreaterThan(0);
      expect(c.proveedoresRef.length).toBeGreaterThan(0); // hay herramientas detrás, pero no en el texto
    }
  });
});

describe('CIA · el usuario autoriza CAPACIDADES, no herramientas', () => {
  it('la autorización registra un resultado del catálogo y jamás un proveedor', async () => {
    const m = montar(); const c = ctx();
    const st = await m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 300000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    expect(st.estado).toBe('AUTORIZADA');
    expect(st.autorizadaPor).toBe(HUMANO);
    const serial = JSON.stringify(st);
    for (const ref of todosLosProveedoresRef()) expect(serial.includes(ref)).toBe(false);
  });
  it('autorizar exige un acto humano (no puede autoautorizarse)', async () => {
    const m = montar(); const c = ctx();
    await expect(m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 1, nivelAutonomia: 'RECOMENDAR', actorHumano: '' }, attr, O)).rejects.toBeInstanceOf(ComandoCiaInvalidoError);
  });
  it('rechaza capacidades fuera del catálogo', async () => {
    const m = montar(); const c = ctx();
    await expect(m.autorizaciones.solicitar(c, 'capacidad-inexistente', attr, O)).rejects.toBeInstanceOf(CapacidadDesconocidaError);
  });
  it('es idempotente y aísla por organización', async () => {
    const store = new InMemoryEventStore(); const m = montar(store);
    await m.autorizaciones.solicitar(ctx('org-a'), 'medir-audiencia', attr, O);
    await m.autorizaciones.solicitar(ctx('org-a'), 'medir-audiencia', attr, O);
    expect(await m.autorizaciones.listar(ctx('org-a'))).toEqual(['medir-audiencia']);
    expect(await m.autorizaciones.listar(ctx('org-b'))).toEqual([]); // otra org no ve nada
  });
});

describe('CIA · no fuga de proveedor en las vistas de usuario', () => {
  it('HOME y Por qué nunca contienen una referencia de proveedor; la auditoría sí', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 300000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'plan-1', { capacidadId: 'captar-clientes-publicidad', objetivo: 'conseguir pacientes', costoEstimado: 50000 }, attr, O);

    const home = await m.lectura.home(c);
    const exp = await m.lectura.explicacion(c, 'plan-1');
    // no lanza: las vistas de usuario están limpias
    verificarSinFugaDeProveedor(home, todosLosProveedoresRef());
    verificarSinFugaDeProveedor(exp, todosLosProveedoresRef());

    // la auditoría SÍ nombra el proveedor detrás de la frontera (rendición de cuentas)
    const audit = await m.lectura.auditoria(c, 'plan-1');
    expect(audit?.proveedorElegidoRef).toBeTruthy();
    expect(todosLosProveedoresRef()).toContain(audit?.proveedorElegidoRef);
  });
});

describe('CIA · sustituir el proveedor NO cambia la experiencia', () => {
  it('la vista de usuario es idéntica con dos proveedores distintos detrás de la frontera', async () => {
    const base = montar(); const c = ctx();
    await base.autorizaciones.autorizar(c, 'enviar-correo', { limite: 1000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await base.planificador.planificar(c, 'p-alfa', { capacidadId: 'enviar-correo', objetivo: 'reactivar clientes', costoEstimado: 100, proveedorOverride: 'correo-alfa' }, attr, O);
    const vistaAlfa = await base.lectura.explicacion(c, 'p-alfa');
    const homeAlfa = await base.lectura.home(c);

    const otro = montar(); const c2 = ctx();
    await otro.autorizaciones.autorizar(c2, 'enviar-correo', { limite: 1000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await otro.planificador.planificar(c2, 'p-alfa', { capacidadId: 'enviar-correo', objetivo: 'reactivar clientes', costoEstimado: 100, proveedorOverride: 'correo-beta' }, attr, O);
    const vistaBeta = await otro.lectura.explicacion(c2, 'p-alfa');
    const homeBeta = await otro.lectura.home(c2);

    expect(vistaAlfa).toEqual(vistaBeta); // misma experiencia
    expect(homeAlfa).toEqual(homeBeta);

    // pero el proveedor detrás SÍ difiere
    const aAlfa = await base.lectura.auditoria(c, 'p-alfa');
    const aBeta = await otro.lectura.auditoria(c2, 'p-alfa');
    expect(aAlfa?.proveedorElegidoRef).toBe('correo-alfa');
    expect(aBeta?.proveedorElegidoRef).toBe('correo-beta');
  });
});

describe('CIA · kill-switch prevalece', () => {
  it('un kill de organización frena el plan; desactivarlo lo vuelve a permitir', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'dar-a-conocer-marca', { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await m.kill.activar(c, 'ORG', attr, O);
    const r1 = await m.planificador.planificar(c, 'k-1', { capacidadId: 'dar-a-conocer-marca', objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect(r1.decision.permitido).toBe(false);
    expect(r1.decision.motivo).toBe('kill_switch');

    await m.kill.desactivar(c, 'ORG', attr, O);
    const r2 = await m.planificador.planificar(c, 'k-2', { capacidadId: 'dar-a-conocer-marca', objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect(r2.decision.permitido).toBe(true);
    expect(r2.plan.estado).toBe('EJECUTADA_SIMULADA');
  });

  it('un kill puesto DESPUÉS de planificar impide la ejecución al aprobar (la pausa prevalece)', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'dar-a-conocer-marca', { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'k-3', { capacidadId: 'dar-a-conocer-marca', objetivo: 'x', costoEstimado: 1000 }, attr, O);
    await m.kill.activar(c, 'dar-a-conocer-marca', attr, O); // pausa la capacidad
    const st = await m.planificador.aprobar(c, 'k-3', HUMANO, attr, O);
    expect(st.estado).toBe('RECHAZADA'); // no se ejecuta pese a la aprobación
  });
});

describe('CIA · límite (presupuesto) frena de verdad', () => {
  it('un costo mayor que el límite no se ejecuta solo: requiere aprobación', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 10000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    const r = await m.planificador.planificar(c, 'b-1', { capacidadId: 'captar-clientes-publicidad', objetivo: 'x', costoEstimado: 50000 }, attr, O);
    expect(r.decision.motivo).toBe('excede_limite');
    expect(r.plan.estado).toBe('PLANIFICADA'); // queda pendiente, no ejecutado
    expect((await m.lectura.decisiones(c)).some((d) => d.planId === 'b-1')).toBe(true);
  });

  it('el consumo simulado se acumula y reduce el disponible', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 10000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'b-2', { capacidadId: 'captar-clientes-publicidad', objetivo: 'x', costoEstimado: 4000 }, attr, O);
    const st = await m.autorizaciones.cargar(c, 'captar-clientes-publicidad');
    expect(st.consumidoSimulado).toBe(4000);
  });
});

describe('CIA · el nivel de autonomía decide aprobación vs. automático', () => {
  it('SOLO_OBSERVAR no planifica acción', () => {
    const cap = CATALOGO_MARKETING[0]!;
    const auth = { ...estadoInicialAutorizacion('org-a', cap.id), existe: true, estado: 'AUTORIZADA' as const, limite: 100000, nivelAutonomia: 'SOLO_OBSERVAR' as const };
    const d = decidirPlan(auth, { organizationId: 'org-a', version: 0, activos: [] }, cap, 10);
    expect(d.permitido).toBe(false);
    expect(d.motivo).toBe('solo_observar');
  });
  it('EJECUTAR_CON_APROBACION deja el plan pendiente en la bandeja', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'dar-a-conocer-marca', { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    const r = await m.planificador.planificar(c, 'a-1', { capacidadId: 'dar-a-conocer-marca', objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect(r.decision.requiereAprobacion).toBe(true);
    expect(r.plan.estado).toBe('PLANIFICADA');
    const st = await m.planificador.aprobar(c, 'a-1', HUMANO, attr, O);
    expect(st.estado).toBe('EJECUTADA_SIMULADA');
  });
});

describe('CIA · preparación cerrada: modo REAL bloqueado', () => {
  it('AUTONOMOUS_REAL es false y planificar en REAL lanza', async () => {
    expect(AUTONOMOUS_REAL).toBe(false);
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'medir-audiencia', { limite: 0, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await expect(m.planificador.planificar(c, 'r-1', { capacidadId: 'medir-audiencia', objetivo: 'x', costoEstimado: 0, modo: 'REAL' }, attr, O)).rejects.toBeInstanceOf(ModoRealBloqueadoError);
  });
});

describe('CIA · reconstrucción por eventos (cold replay)', () => {
  it('el estado se reconstruye desde cero con los mismos eventos', async () => {
    const store = new InMemoryEventStore(); const m = montar(store); const c = ctx();
    await m.autorizaciones.autorizar(c, 'enviar-correo', { limite: 1000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'rp-1', { capacidadId: 'enviar-correo', objetivo: 'x', costoEstimado: 100 }, attr, O);
    // servicios nuevos sobre el MISMO store: mismo estado
    const m2 = montar(store);
    const plan = await m2.planificador.cargar(c, 'rp-1');
    expect(plan.estado).toBe('EJECUTADA_SIMULADA');
    const auth = await m2.autorizaciones.cargar(c, 'enviar-correo');
    expect(auth.consumidoSimulado).toBe(100);
  });
});
