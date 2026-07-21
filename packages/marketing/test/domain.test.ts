import { describe, expect, it } from 'vitest';
import { validarObjetivo } from '../src/domain/objetivo';
import { transicionValida } from '../src/domain/plan';
import { planificar } from '../src/domain/planner';
import { objetivoDemo, optsDemo, politicaDemo } from '../src/fixtures';
import type { VersionPolitica } from '@soec/operacional';
import { attr } from './helpers';

const politicaVersion: VersionPolitica = { ...politicaDemo, version: 1, vigenciaDesde: '2026-01-01T00:00:00.000Z', atribucion: attr };

describe('Dominio de marketing', () => {
  it('valida objetivos: evaluable, con faltantes, e imposibles', () => {
    expect(validarObjetivo(objetivoDemo).evaluable).toBe(true);
    expect(validarObjetivo({ ...objetivoDemo, audiencia: '' }).faltantes).toContain('audiencia');
    expect(validarObjetivo({ ...objetivoDemo, valorEsperado: 5 }).error).toBe('objetivo_no_supera_linea_base');
    expect(validarObjetivo({ ...objetivoDemo, horizonteDias: 0 }).error).toBe('horizonte_no_positivo');
  });

  it('la máquina de estados de actividad rechaza transiciones inválidas', () => {
    expect(transicionValida('autorizable', 'autorizada')).toBe(true);
    expect(transicionValida('verificada', 'autorizable')).toBe(false);
    expect(transicionValida('propuesta', 'ejecutada')).toBe(false);
  });

  it('el planificador es determinístico: mismas entradas → mismo plan', () => {
    const a = planificar(objetivoDemo, politicaVersion, { fechaInicio: '2026-03-02T09:00:00.000Z', ...optsDemo }, 1, 'x');
    const b = planificar(objetivoDemo, politicaVersion, { fechaInicio: '2026-03-02T09:00:00.000Z', ...optsDemo }, 1, 'x');
    expect(a).toEqual(b);
  });

  it('el plan separa lo ejecutable de lo bloqueado y lo explica', () => {
    const p = planificar(objetivoDemo, politicaVersion, { fechaInicio: '2026-03-02T09:00:00.000Z', ...optsDemo }, 1, 'x');
    // youtube no autorizado → bloqueada; blog_tecnico sin contenido → bloqueada; blog → autorizable.
    expect(p.actividades.some((a) => a.canal === 'youtube' && a.estado === 'bloqueada' && a.motivoBloqueo === 'canal_no_autorizado')).toBe(true);
    expect(p.actividades.some((a) => a.canal === 'blog_tecnico' && a.estado === 'bloqueada' && a.motivoBloqueo === 'contenido_faltante')).toBe(true);
    expect(p.actividades.some((a) => a.canal === 'blog' && a.estado === 'autorizable')).toBe(true);
    expect(p.estado).toBe('parcialmente_bloqueado');
    for (const a of p.actividades) expect(a.explicacion).toBeTruthy();
  });

  it('respeta la frecuencia (número de actividades por campaña)', () => {
    const p = planificar(objetivoDemo, politicaVersion, { fechaInicio: '2026-03-02T09:00:00.000Z', ...optsDemo }, 1, 'x');
    const blog = p.actividades.filter((a) => a.canal === 'blog');
    expect(blog.length).toBe(Math.floor(objetivoDemo.horizonteDias / objetivoDemo.frecuenciaDias));
  });
});
