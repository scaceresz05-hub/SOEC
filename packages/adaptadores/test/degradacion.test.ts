/**
 * @soec/adaptadores · M4-C-A-H · degradación gobernada (C-4). Ante una capacidad no plenamente consumible,
 * el sandbox NO ignora la política: la traduce a una directiva explícita. Sólo SIMULAR permite continuar.
 */
import { describe, expect, it } from 'vitest';
import { Sandbox } from '../src/index';
import { O, cap, ctx, frontHabilitado, solicitud } from './helpers';

const sb = new Sandbox();
const adaptador = {
  nombre: 'fake', capacidad: 'generacion', version: '1.0.0',
  async salud() { return { estado: 'SALUDABLE' as const, detalle: '' }; },
  async ejecutar() { return { estado: 'OK' as const, salida: { k: 'v' }, error: null }; },
};

// Capacidad NO consumible (salud NO_CONFIABLE) con cada política; solicitud REAL habilitada en frontera.
const real = (politica: 'ABSTENER' | 'SIMULAR' | 'ALTERNATIVA' | 'CACHE' | 'DETENER') =>
  sb.ejecutar(adaptador, ctx(), solicitud(), cap({ salud: 'NO_CONFIABLE', politicaDegradacion: politica }), O, {
    modoDeseado: 'REAL',
    estadoAdaptador: frontHabilitado,
  });

describe('@soec/adaptadores · degradación gobernada (C-4)', () => {
  it('ABSTENER → rechazo con directiva RECHAZADO_ABSTENCION', async () => {
    const { resultado, evidencia } = await real('ABSTENER');
    expect(resultado.estado).toBe('ERROR');
    expect(evidencia.degradacion).toBe('RECHAZADO_ABSTENCION');
  });

  it('SIMULAR → ejecuta explícitamente en SIMULADO', async () => {
    const { resultado, evidencia } = await real('SIMULAR');
    expect(resultado.estado).toBe('OK');
    expect(resultado.modoEjecutado).toBe('SIMULADO');
    expect(resultado.naturaleza).toBe('SIMULADA');
    expect(evidencia.degradacion).toBe('EJECUTAR_SIMULADO');
  });

  it('DETENER → error terminal gobernado', async () => {
    const { evidencia, resultado } = await real('DETENER');
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
    expect(evidencia.degradacion).toBe('DETENIDO');
  });

  it('ALTERNATIVA → REQUIERE_RESOLUCION_DE_ALTERNATIVA (no ejecuta)', async () => {
    const { evidencia } = await real('ALTERNATIVA');
    expect(evidencia.degradacion).toBe('REQUIERE_RESOLUCION_DE_ALTERNATIVA');
  });

  it('CACHE → REQUIERE_RESOLUCION_DE_CACHE (no ejecuta)', async () => {
    const { evidencia } = await real('CACHE');
    expect(evidencia.degradacion).toBe('REQUIERE_RESOLUCION_DE_CACHE');
  });

  it('la versión de política queda registrada en la evidencia', async () => {
    const { evidencia } = await real('SIMULAR');
    expect(evidencia.politicaVersion).toBe(1);
  });
});
