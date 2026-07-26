/**
 * Capa de Producto causal v1.1: señales (con condición de activación) y mapeos
 * versionados (señal → objetivo → estrategia), expuestos por el puerto y con
 * integridad referencial validada.
 */
import { describe, it, expect } from 'vitest';
import { crearBiblioteca } from '../src/domain/port';
import { validarBiblioteca } from '../src/domain/validacion';
import { conocimientoClinicaDental } from '../src/rubros/clinica-dental';
import { crearBibliotecaClinicaDental } from '../src/index';

describe('@soec/rubros · señales y mapeos (v1.1)', () => {
  it('el puerto expone señales RATIFIED con condición de activación', () => {
    const senales = crearBibliotecaClinicaDental().senales();
    expect(senales.map((s) => s.nombre).sort()).toEqual([
      'ALTO_NO_SHOW',
      'BAJA_TASA_AGENDAMIENTO',
      'POCAS_SOLICITUDES',
      'POCA_RECOMPRA',
    ]);
    for (const s of senales) {
      expect(s.condicionActivacion.operador).toBe('IGUAL_A');
      expect(s.condicionActivacion.valor).toBe(true);
    }
  });

  it('los mapeos ligan señal → objetivo → estrategia (MAP-CD-02 corregido a OBJ-CD-07)', () => {
    const mapeos = crearBibliotecaClinicaDental().mapeos();
    const m2 = mapeos.find((m) => m.id === 'MAP-CD-02')!;
    expect(m2.senalId).toBe('SIG-CD-02');
    expect(m2.objetivoId).toBe('OBJ-CD-07');
    expect(m2.estrategiaId).toBe('EST-CD-05');
  });

  it('la señal referencia una pregunta diagnóstica existente', () => {
    const preguntas = new Set(crearBibliotecaClinicaDental().preguntasDiagnosticas());
    for (const s of conocimientoClinicaDental.senales)
      expect(preguntas.has(s.preguntaId)).toBe(true);
  });

  it('rechaza un mapeo hacia un objetivo no RATIFIED', () => {
    const rota = {
      ...conocimientoClinicaDental,
      mapeos: [{ ...conocimientoClinicaDental.mapeos[0]!, objetivoId: 'OBJ-CD-06' }], // DRAFT
    };
    const v = validarBiblioteca(rota);
    expect(v.valido).toBe(false);
    expect(v.errores.some((e) => e.codigo === 'mapeo_objetivo_invalido')).toBe(true);
  });

  it('rechaza una señal cuya pregunta no existe', () => {
    const rota = {
      ...conocimientoClinicaDental,
      senales: [{ ...conocimientoClinicaDental.senales[0]!, preguntaId: '¿Pregunta inexistente?' }],
    };
    const v = validarBiblioteca(rota);
    expect(v.valido).toBe(false);
    expect(v.errores.some((e) => e.codigo === 'senal_sin_pregunta')).toBe(true);
  });

  it('crea la biblioteca sin errores de validación', () => {
    expect(() => crearBiblioteca(conocimientoClinicaDental)).not.toThrow();
  });
});
