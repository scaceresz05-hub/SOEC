/**
 * Validación del comando: justificación estructurada, huella del rubro válida y
 * coherencia/integridad ACEPTADO/RECHAZADO (candidato dentro de la propuesta y no alterado).
 */
import { describe, it, expect } from 'vitest';
import {
  validarDecision,
  CATEGORIAS_JUSTIFICACION,
  type ComandoDecision,
  type JustificacionHumana,
} from '../src/index';
import type { ResultadoEstrategia } from '@soec/estrategia';
import { propuestaReal } from './helpers';

function cmd(over: Partial<ComandoDecision>): ComandoDecision {
  const { snapshot, candidato } = propuestaReal();
  return {
    decisionId: 'd1',
    resultado: 'ACEPTADO',
    candidatoElegido: candidato,
    propuesta: snapshot,
    justificacion: { texto: 'porque atiende el cuello de botella', categoria: 'NEGOCIO' },
    ...over,
  };
}

describe('@soec/decision · validación', () => {
  it('categorías son un conjunto cerrado', () => {
    expect(CATEGORIAS_JUSTIFICACION).toEqual([
      'NEGOCIO',
      'PRESUPUESTO',
      'RIESGO',
      'REGULATORIO',
      'PRIORIDAD',
      'OTRO',
    ]);
  });
  it('ACEPTADO válido no produce errores', () => {
    expect(validarDecision(cmd({}))).toEqual([]);
  });
  it('RECHAZADO válido (sin candidato) no produce errores', () => {
    expect(validarDecision(cmd({ resultado: 'RECHAZADO', candidatoElegido: null }))).toEqual([]);
  });
  it('justificación vacía se rechaza', () => {
    expect(
      validarDecision(cmd({ justificacion: { texto: '  ', categoria: 'NEGOCIO' } })),
    ).toContain('justificacion_vacia');
  });
  it('categoría fuera del conjunto se rechaza', () => {
    const mala = { texto: 'x', categoria: 'MARKETING' } as unknown as JustificacionHumana;
    expect(validarDecision(cmd({ justificacion: mala }))).toContain('categoria_invalida');
  });
  it('huella del rubro con formato inválido se rechaza', () => {
    const { snapshot } = propuestaReal();
    expect(
      validarDecision(cmd({ propuesta: { ...snapshot, rubroHuella: 'no-es-sha256' } })),
    ).toContain('rubro_huella_invalida');
  });
  it('ACEPTADO sin candidato se rechaza', () => {
    expect(validarDecision(cmd({ candidatoElegido: null }))).toContain('aceptado_sin_candidato');
  });
  it('RECHAZADO con candidato se rechaza', () => {
    expect(validarDecision(cmd({ resultado: 'RECHAZADO' }))).toContain('rechazado_con_candidato');
  });
  it('ACEPTADO sobre un resultado de ABSTENCION se rechaza', () => {
    const { snapshot } = propuestaReal();
    const abst: ResultadoEstrategia = {
      tipo: 'ABSTENCION',
      abstencion: { razon: 'sin señal', faltantesRelevantes: [] },
    };
    expect(validarDecision(cmd({ propuesta: { ...snapshot, resultado: abst } }))).toContain(
      'resultado_no_es_propuesta',
    );
  });
  it('candidato fuera de la propuesta se rechaza', () => {
    const { candidato } = propuestaReal();
    expect(
      validarDecision(cmd({ candidatoElegido: { ...candidato, objetivoId: 'OBJ-INEXISTENTE' } })),
    ).toContain('candidato_fuera_de_la_propuesta');
  });
  it('candidato con contenido alterado se rechaza', () => {
    const { candidato } = propuestaReal();
    const alterado = {
      ...candidato,
      confianza: candidato.confianza === 'HIGH' ? ('LOW' as const) : ('HIGH' as const),
    };
    expect(validarDecision(cmd({ candidatoElegido: alterado }))).toContain('candidato_alterado');
  });
});
