import { describe, expect, it } from 'vitest';
import {
  calcularSalud,
  estaPausado,
  puede,
  reconstruirPausa,
  type ContenidoDecision,
  type SenalesSalud,
} from '../src';
import { attr, ctxFor, montar, now } from './helpers';

const senalesBase: SenalesSalud = { pausaTotal: false, riesgoCritico: 0, intervencionRequerida: 0, bloqueos: 0, advertencias: 0, conDatos: true };

describe('Dominio del Centro de Control', () => {
  it('la salud respeta la precedencia determinista', () => {
    expect(calcularSalud({ ...senalesBase, pausaTotal: true, riesgoCritico: 5 })).toBe('pausado');
    expect(calcularSalud({ ...senalesBase, riesgoCritico: 1 })).toBe('intervencion_requerida');
    expect(calcularSalud({ ...senalesBase, intervencionRequerida: 1 })).toBe('intervencion_requerida');
    expect(calcularSalud({ ...senalesBase, bloqueos: 3 })).toBe('parcialmente_bloqueado');
    expect(calcularSalud({ ...senalesBase, bloqueos: 1 })).toBe('degradado');
    expect(calcularSalud({ ...senalesBase, conDatos: false })).toBe('sin_informacion');
    expect(calcularSalud({ ...senalesBase, advertencias: 2 })).toBe('operando_con_advertencias');
    expect(calcularSalud(senalesBase)).toBe('saludable');
  });

  it('los permisos por rol son correctos', () => {
    expect(puede('propietario', 'aprobar_alto_riesgo')).toBe(true);
    expect(puede('supervisor', 'aprobar_alto_riesgo')).toBe(false);
    expect(puede('observador', 'pausar')).toBe(false);
    expect(puede('operador_tecnico', 'reconciliar')).toBe(true);
  });

  it('la pausa propaga por alcance genérico: global cubre todo; la parcial solo su alcance', async () => {
    const m = montar();
    const ctx = ctxFor();
    const canal = (v: string) => [{ tipo: 'canal', valor: v }];
    await m.pausa.pausar(ctx, { tipo: 'canal', valor: 'blog' }, 'prueba', 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, canal('blog'))).toBe(true);
    expect(await m.pausa.estaPausado(ctx, canal('linkedin'))).toBe(false);
    await m.pausa.pausar(ctx, { tipo: 'departamento', valor: '*' }, 'pausa total', 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, canal('linkedin'))).toBe(true); // global precede
    await m.pausa.reanudar(ctx, { tipo: 'departamento', valor: '*' }, 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, canal('linkedin'))).toBe(false);
    expect(await m.pausa.estaPausado(ctx, canal('blog'))).toBe(true); // la pausa de canal persiste
  });

  it('un alcance FUTURO funciona sin modificar el núcleo; los alcances malformados se rechazan', async () => {
    const m = montar();
    const ctx = ctxFor();
    // Un departamento futuro pausa 'inventario:almacen-1' sin tocar @soec/control.
    await m.pausa.pausar(ctx, { tipo: 'inventario', valor: 'almacen-1' }, 'quiebre de stock', 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, [{ tipo: 'inventario', valor: 'almacen-1' }])).toBe(true);
    expect(await m.pausa.estaPausado(ctx, [{ tipo: 'inventario', valor: 'almacen-2' }])).toBe(false);
    await expect(m.pausa.pausar(ctx, { tipo: 'Canal Malo', valor: 'x' }, 'm', 'p', attr, now)).rejects.toThrow();
    await expect(m.pausa.pausar(ctx, { tipo: 'canal', valor: '' }, 'm', 'p', attr, now)).rejects.toThrow();
  });

  it('la reconstrucción de la pausa es idéntica desde eventos', async () => {
    const m = montar();
    const ctx = ctxFor();
    await m.pausa.pausar(ctx, { tipo: 'canal', valor: 'blog' }, 'x', 'p', attr, now);
    const eventos = await m.store.readStream(ctx, `pausa:orgA`);
    expect(estaPausado(reconstruirPausa('orgA', eventos), [{ tipo: 'canal', valor: 'blog' }])).toBe(true);
  });

  it('una decisión se resuelve una vez; el alto riesgo exige permiso; el observador no puede', async () => {
    const m = montar();
    const ctx = ctxFor();
    const contenido: ContenidoDecision = { tipo: 'escalamiento_frecuencia', razon: 'r', alcance: 'blog/act', efectoEsperado: 'e', riesgo: 'alto', presupuestoImplicado: 0, evidencia: 'ev', alternativas: [], recomendacionSistema: 'rec', politica: 'pol', refPlan: 'plan' };
    await m.decisiones.registrar(ctx, 'dec-1', contenido, attr, now);
    await expect(m.decisiones.resolver(ctx, 'dec-1', { estado: 'aprobada', actor: 'obs', rol: 'observador' }, attr, now)).rejects.toThrow();
    await expect(m.decisiones.resolver(ctx, 'dec-1', { estado: 'aprobada', actor: 'sup', rol: 'supervisor' }, attr, now)).rejects.toThrow(); // alto riesgo
    const d = await m.decisiones.resolver(ctx, 'dec-1', { estado: 'aprobada', actor: 'dueño', rol: 'propietario' }, attr, now);
    expect(d.estado).toBe('aprobada');
    await expect(m.decisiones.resolver(ctx, 'dec-1', { estado: 'denegada', actor: 'dueño', rol: 'propietario' }, attr, now)).rejects.toThrow(); // ya resuelta
  });

  it('las alertas se deduplican por clave mientras estén abiertas', async () => {
    const m = montar();
    const ctx = ctxFor();
    const al = { clave: 'gasto:pub-1', tipo: 'gasto_anomalo', severidad: 'critico' as const, origen: 'medicion', entidad: 'pub-1', evidencia: 'e', impacto: 'i', accionAutomatica: 'a', accionHumana: 'h' };
    await m.inbox.registrarAlerta(ctx, al, attr, now);
    const s = await m.inbox.registrarAlerta(ctx, al, attr, now);
    expect(Object.keys(s.alertas).length).toBe(1);
  });

  it('los catálogos son EXTENSIBLES: un departamento futuro registra tipos sin tocar el núcleo; los malformados se rechazan', async () => {
    const m = montar();
    const ctx = ctxFor();
    // Tipo de decisión de un departamento ficticio (ventas), no presente en el catálogo base.
    const decVentas: ContenidoDecision = { tipo: 'aprobar_reembolso', razon: 'r', alcance: 'ventas/caso-1', efectoEsperado: 'e', riesgo: 'medio', presupuestoImplicado: 0, evidencia: 'ev', alternativas: [], recomendacionSistema: 'rec', politica: 'pol', refPlan: '—' };
    const d = await m.decisiones.registrar(ctx, 'dec-ventas', decVentas, attr, now);
    expect(d.contenido?.tipo).toBe('aprobar_reembolso');
    // Alerta de un módulo futuro (inventario).
    const s = await m.inbox.registrarAlerta(ctx, { clave: 'stock:almacen-1', tipo: 'quiebre_stock', severidad: 'mayor', origen: 'inventario', entidad: 'almacen-1', evidencia: 'e', impacto: 'i', accionAutomatica: 'a', accionHumana: 'h' }, attr, now);
    expect(s.alertas['stock:almacen-1']?.tipo).toBe('quiebre_stock');
    // Malformados y vacíos → rechazados (validación de formato).
    await expect(m.decisiones.registrar(ctx, 'dec-bad', { ...decVentas, tipo: '' }, attr, now)).rejects.toThrow();
    await expect(m.decisiones.registrar(ctx, 'dec-bad2', { ...decVentas, tipo: 'Tipo Malo' }, attr, now)).rejects.toThrow();
  });
});
