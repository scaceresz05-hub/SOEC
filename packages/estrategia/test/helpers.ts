/**
 * Builders de prueba: comprensiones que activan señales concretas del rubro real.
 */
import { crearBibliotecaClinicaDental } from '@soec/rubros';
import type { RubroKnowledgePort } from '@soec/rubros';
import type {
  ComprensionEvaluable,
  ContradiccionDiagnostico,
  FaltanteDiagnostico,
  HechoComprendido,
} from '@soec/diagnostico';
import type { CandidatoEstrategia, ResultadoEstrategia } from '../src/index';

export const clinic = () => crearBibliotecaClinicaDental();

/** Hecho que responde la pregunta de una señal con un valor normalizado. */
export function hechoSenal(
  rubro: RubroKnowledgePort,
  nombre: string,
  valor = true,
): HechoComprendido {
  const s = rubro.senales().find((x) => x.nombre === nombre)!;
  return {
    preguntaId: s.preguntaId,
    afirmacionId: `af-${nombre}`,
    evidenciaIds: [`ev-${nombre}`],
    enunciado: `respuesta a ${nombre}`,
    valor,
  };
}

export function hecho(preguntaId: string, enunciado: string): HechoComprendido {
  return {
    preguntaId,
    afirmacionId: `af-${preguntaId}`,
    evidenciaIds: [`ev-${preguntaId}`],
    enunciado,
  };
}
export function faltante(preguntaId: string): FaltanteDiagnostico {
  return {
    preguntaId,
    motivo: 'SIN_RESPUESTA',
    mensaje: `No existe información suficiente sobre: ${preguntaId}`,
  };
}
export function contradiccion(preguntaId: string): ContradiccionDiagnostico {
  return {
    preguntaId,
    afirmacionId: `af-${preguntaId}`,
    evidenciaAFavor: [`si-${preguntaId}`],
    evidenciaEnContra: [`no-${preguntaId}`],
  };
}

export function comp(o: {
  hechos?: readonly HechoComprendido[];
  faltantes?: readonly FaltanteDiagnostico[];
  contradicciones?: readonly ContradiccionDiagnostico[];
}): ComprensionEvaluable {
  return {
    diagnosticoId: 'dx',
    rubroId: 'clinica-dental',
    hechos: o.hechos ?? [],
    faltantes: o.faltantes ?? [],
    contradicciones: o.contradicciones ?? [],
    abstenido: false,
    comprension: {
      nombre: 'Comprender el estado',
      incertidumbre: 'media',
      contradiccionesAbiertas: [],
      faltante: [],
      productoCompuesto: [],
    },
    operaciones: [{ operacion: 'detectar', mecanismo: 'determinístico' }],
  };
}

/** Devuelve los candidatos de una PROPUESTA (lanza si es ABSTENCION). */
export function candidatosDe(r: ResultadoEstrategia): readonly CandidatoEstrategia[] {
  if (r.tipo !== 'PROPUESTA') throw new Error(`esperaba PROPUESTA, fue ${r.tipo}`);
  return r.candidatos;
}
