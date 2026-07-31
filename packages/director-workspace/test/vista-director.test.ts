/**
 * Vista del ciclo del Director (Bloque I). Verifica que la vista compone las secciones del ciclo
 * gobernado y, sobre todo, que declara la NATURALEZA de cada dato (REAL/SIMULADO/ESTIMADO/
 * DESCONOCIDO) sin confundir una emulación con un hecho, y que la próxima recomendación respeta
 * el modo seguro y la evaluabilidad.
 */
import { describe, it, expect } from 'vitest';
import { estadoInicialAutonomia } from '@soec/autonomia';
import { estadoInicialCampania } from '@soec/campanias';
import { estadoInicialContenido } from '@soec/contenido-gobernado';
import { estadoInicialEjecucion, type RegistroEjecucion } from '@soec/ejecucion-simulada';
import { evaluarResultadoCampania, type ConversionObservada } from '@soec/medicion';
import { estadoInicialAprendizaje } from '@soec/aprendizaje';
import { componerVistaDirector, type InsumosVista } from '../src/index';

const ORG = 'smileflow';

function registro(over: Partial<RegistroEjecucion> = {}): RegistroEjecucion {
  return {
    requestId: 'req:1',
    idempotencyKey: 'k1',
    adaptador: 'adaptador-test',
    canal: 'correo',
    organizacionId: ORG,
    contenidoId: 'ct1',
    campaniaId: 'c1',
    escenario: 'SUCCESS',
    resultado: 'PUBLICADA_SIMULADA',
    reintentable: false,
    intento: 1,
    simulado: true,
    mensaje: '[SIMULADO]',
    en: '2026-07-30T00:00:00.000Z',
    ...over,
  };
}

function conv(campaignRef: string | null, valor: number): ConversionObservada {
  return { id: 'v1', externalRef: null, campaignRef, valor, ocurridoEn: '2026-08-10T00:00:00.000Z' };
}

function insumos(over: Partial<InsumosVista> = {}): InsumosVista {
  return {
    organizacionActiva: ORG,
    autonomia: { ...estadoInicialAutonomia(ORG), nivel: 2, existe: true },
    objetivo: { texto: 'Generar solicitudes de demostración', decisionId: 'd1' },
    justificacion: 'la señal activa es POCAS_SOLICITUDES',
    evaluable: true,
    faltantes: [],
    campanias: [{ ...estadoInicialCampania(ORG, 'c1'), existe: true }],
    contenidos: [],
    ejecuciones: [],
    resultado: null,
    aprendizajes: [],
    ...over,
  };
}

describe('@soec/director-workspace · naturaleza de los datos', () => {
  it('el objetivo con decisión es REAL; sin objetivo es DESCONOCIDO', () => {
    expect(componerVistaDirector(insumos()).objetivo.naturaleza).toBe('REAL');
    expect(componerVistaDirector(insumos({ objetivo: null })).objetivo.naturaleza).toBe('DESCONOCIDO');
  });

  it('las ejecuciones se muestran SIEMPRE como SIMULADO', () => {
    const ejec = { ...estadoInicialEjecucion(ORG, 'ct1'), registros: [registro()], publicacionesSimuladas: 1 };
    const v = componerVistaDirector(insumos({ ejecuciones: [ejec] }));
    expect(v.ejecucionesSimuladas).toHaveLength(1);
    expect(v.ejecucionesSimuladas[0]!.naturaleza).toBe('SIMULADO');
  });

  it('un ROI con ingresos SIMULADOS se declara SIMULADO (no real)', () => {
    const resultado = evaluarResultadoCampania({
      organizacionId: ORG,
      campaignRef: 'c1',
      ventana: '2026-08',
      gasto: { valor: 100000, procedencia: 'OBSERVADA' },
      ingresos: { valor: 300000, procedencia: 'SIMULADA' },
      conversiones: [conv('c1', 300000)],
      periodoCompleto: true,
    });
    const v = componerVistaDirector(insumos({ resultado }));
    expect(v.resultado.naturaleza).toBe('SIMULADO');
    expect(v.proximaRecomendacion).toContain('no es concluyente');
  });

  it('un ROI observado, atribuido y en período cerrado se declara REAL', () => {
    const resultado = evaluarResultadoCampania({
      organizacionId: ORG,
      campaignRef: 'c1',
      ventana: '2026-08',
      gasto: { valor: 100000, procedencia: 'OBSERVADA' },
      ingresos: { valor: 300000, procedencia: 'OBSERVADA' },
      conversiones: [conv('c1', 300000)],
      periodoCompleto: true,
    });
    const v = componerVistaDirector(insumos({ resultado }));
    expect(v.resultado.naturaleza).toBe('REAL');
    expect(v.resultado.valor).toBeCloseTo(2);
    expect(v.proximaRecomendacion).toContain('concluyente');
  });
});

describe('@soec/director-workspace · modo seguro y evaluabilidad', () => {
  it('en modo seguro (PAUSA) marca bloqueo y recomienda reanudación humana', () => {
    const v = componerVistaDirector(insumos({ autonomia: { ...estadoInicialAutonomia(ORG), pausado: true, existe: true } }));
    expect(v.modoSeguro).toBe(true);
    expect(v.bloqueos.some((b) => b.includes('MODO_SEGURO'))).toBe(true);
    expect(v.proximaRecomendacion).toContain('pausa');
  });

  it('sin evaluabilidad marca NO_EVALUABLE y recomienda completar datos', () => {
    const v = componerVistaDirector(insumos({ evaluable: false, faltantes: ['presupuesto'] }));
    expect(v.calidadEvaluabilidad).toBe('NO_EVALUABLE');
    expect(v.pendientes.some((p) => p.includes('presupuesto'))).toBe(true);
    expect(v.proximaRecomendacion).toContain('Faltan datos');
  });

  it('un contenido RECHAZADO aparece como bloqueo', () => {
    const contenido = { ...estadoInicialContenido(ORG, 'ct1'), existe: true, estado: 'RECHAZADO' as const };
    const v = componerVistaDirector(insumos({ contenidos: [contenido] }));
    expect(v.bloqueos.some((b) => b.includes('RECHAZADO'))).toBe(true);
  });

  it('lista aprendizajes con su conclusión y si son reutilizables', () => {
    const ap = {
      ...estadoInicialAprendizaje(ORG, 'ap1'),
      existe: true,
      conclusion: { enunciado: 'usar prueba social', soporte: 'evidencia_suficiente' as const, accionRecomendada: 'adoptar' },
      reutilizable: { enunciado: 'prueba social ayuda', condiciones: [], ambitoSugerido: [ORG] },
    };
    const v = componerVistaDirector(insumos({ aprendizajes: [ap] }));
    expect(v.aprendizajes).toHaveLength(1);
    expect(v.aprendizajes[0]!.conclusion).toBe('usar prueba social');
    expect(v.aprendizajes[0]!.reutilizable).toBe(true);
  });
});
