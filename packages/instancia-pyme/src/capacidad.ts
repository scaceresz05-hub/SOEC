/**
 * Primera capacidad real: «Comprender el estado» (familia #14 §4).
 *
 * Propósito humano: que la persona responsable de la pyme comprenda el estado
 * actual de su organización y su entorno, con sus tensiones, contradicciones y
 * faltantes visibles. Compone DETECTAR (hacer visible lo no visto) + ESCLARECER
 * (hacer comprensible una tensión), sin proyectar, orientar ni decidir. Es una
 * INSTANCIACIÓN registrada sobre el sistema existente, no una excepción.
 */
import type { Attribution } from '@soec/contracts';
import type { DefinicionInput } from '@soec/capacidades';

export function capacidadComprenderEstado(atribucion: Attribution): DefinicionInput {
  return {
    nombre: 'Comprender el estado (pyme de servicios)',
    proposito:
      'que la persona responsable comprenda el estado actual de la pyme y su entorno, con sus tensiones y faltantes visibles',
    familia: 'comprender-el-estado',
    pasos: [
      {
        stepId: 'd1',
        operacion: 'detectar',
        porque: 'hacer visibles las tensiones, contradicciones y ausencias del estado',
        dependeDe: [],
        usaProductoDe: null,
        objetivoElementoId: null,
        horizonte: null,
        obligatorio: true,
      },
      {
        stepId: 'e1',
        operacion: 'esclarecer',
        porque: 'hacer comprensible una tensión detectada, sin resolverla',
        dependeDe: ['d1'],
        usaProductoDe: 'd1',
        objetivoElementoId: null,
        horizonte: null,
        obligatorio: false,
      },
    ],
    condicionesEntrada: ['existe un ECE integrado de la pyme'],
    condicionesAbstencion: ['no hay comprensión suficiente que hacer inteligible'],
    contrato: {
      entrega: 'una comprensión explicada del estado, con tensiones y faltantes visibles',
      limite: 'no proyecta, no orienta, no decide; el juicio es de la persona',
    },
    componeCapacidades: [],
    vigencia: { desde: '2026-01-01T00:00:00.000Z', hasta: null },
    atribucion,
  };
}
