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

  it('la pausa propaga: la pausa total cubre todo; la parcial solo su alcance', async () => {
    const m = montar();
    const ctx = ctxFor();
    await m.pausa.pausar(ctx, { tipo: 'canal', valor: 'blog' }, 'prueba', 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, { canal: 'blog' })).toBe(true);
    expect(await m.pausa.estaPausado(ctx, { canal: 'linkedin' })).toBe(false);
    await m.pausa.pausar(ctx, { tipo: 'departamento', valor: '*' }, 'pausa total', 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, { canal: 'linkedin' })).toBe(true);
    await m.pausa.reanudar(ctx, { tipo: 'departamento', valor: '*' }, 'propietario', attr, now);
    expect(await m.pausa.estaPausado(ctx, { canal: 'linkedin' })).toBe(false);
    expect(await m.pausa.estaPausado(ctx, { canal: 'blog' })).toBe(true); // la pausa de canal persiste
  });

  it('la reconstrucción de la pausa es idéntica desde eventos', async () => {
    const m = montar();
    const ctx = ctxFor();
    await m.pausa.pausar(ctx, { tipo: 'canal', valor: 'blog' }, 'x', 'p', attr, now);
    const eventos = await m.store.readStream(ctx, `pausa:orgA`);
    expect(estaPausado(reconstruirPausa('orgA', eventos), { canal: 'blog' })).toBe(true);
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
    const al = { clave: 'gasto:pub-1', tipo: 'gasto_anomalo' as const, severidad: 'critico' as const, origen: 'medicion', entidad: 'pub-1', evidencia: 'e', impacto: 'i', accionAutomatica: 'a', accionHumana: 'h' };
    await m.inbox.registrarAlerta(ctx, al, attr, now);
    const s = await m.inbox.registrarAlerta(ctx, al, attr, now);
    expect(Object.keys(s.alertas).length).toBe(1);
  });
});
