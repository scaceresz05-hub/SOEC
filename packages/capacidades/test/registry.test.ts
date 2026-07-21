import { describe, expect, it } from 'vitest';
import {
  CicloDetectadoError,
  DefinicionInvalidaError,
  OperacionDesconocidaError,
  VersionNoDisponibleError,
} from '../src/domain/errors';
import { ctxFor, defDetectarOrientar, defEsclarecerSimple, montar } from './helpers';

describe('CapabilityRegistry — definición versionada y validación', () => {
  it('registra versiones sucesivas sin reescribir', async () => {
    const e = montar();
    const ctx = ctxFor('orgA');
    const r1 = await e.registry.registrarVersion(ctx, 'cap1', defEsclarecerSimple());
    const r2 = await e.registry.registrarVersion(ctx, 'cap1', defDetectarOrientar());
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    const st = await e.capQuery.definicion(ctx, 'cap1');
    expect(Object.keys(st.versiones)).toEqual(['1', '2']);
  });

  it('publica una versión y la resuelve como vigente; retirar la excluye', async () => {
    const e = montar();
    const ctx = ctxFor('orgA');
    await e.registry.registrarVersion(ctx, 'cap1', defEsclarecerSimple());
    await e.registry.publicar(ctx, 'cap1', 1);
    expect((await e.registry.resolver(ctx, 'cap1')).version).toBe(1);
    await e.registry.retirar(ctx, 'cap1', 1);
    await expect(e.registry.resolver(ctx, 'cap1', 1)).rejects.toBeInstanceOf(VersionNoDisponibleError);
  });

  it('rechaza propósito vacío', async () => {
    const e = montar();
    const def = { ...defEsclarecerSimple(), proposito: '  ' };
    await expect(e.registry.registrarVersion(ctxFor('orgA'), 'cap1', def)).rejects.toBeInstanceOf(DefinicionInvalidaError);
  });

  it('rechaza una operación desconocida (no está en el #13)', async () => {
    const e = montar();
    const def = { ...defEsclarecerSimple(), pasos: [{ ...defEsclarecerSimple().pasos[0]!, operacion: 'inferir' as never }] };
    await expect(e.registry.registrarVersion(ctxFor('orgA'), 'cap1', def)).rejects.toBeInstanceOf(OperacionDesconocidaError);
  });

  it('rechaza un ciclo entre pasos', async () => {
    const e = montar();
    const def = {
      ...defDetectarOrientar(),
      pasos: [
        { stepId: 'a', operacion: 'detectar' as const, porque: 'x', dependeDe: ['b'], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: true },
        { stepId: 'b', operacion: 'orientar' as const, porque: 'x', dependeDe: ['a'], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: true },
      ],
    };
    await expect(e.registry.registrarVersion(ctxFor('orgA'), 'cap1', def)).rejects.toBeInstanceOf(CicloDetectadoError);
  });

  it('rechaza que una capacidad se componga de sí misma (ciclo de capacidades)', async () => {
    const e = montar();
    const def = { ...defEsclarecerSimple(), componeCapacidades: ['cap1'] };
    await expect(e.registry.registrarVersion(ctxFor('orgA'), 'cap1', def)).rejects.toBeInstanceOf(CicloDetectadoError);
  });
});
