/**
 * @soec/capacidades · catálogo · definición NEUTRAL y ÚNICA de «Comprender el estado».
 *
 * Fuente declarativa única de la capacidad (familia `comprender-el-estado`),
 * consumida por todos los dominios/instancias (p. ej. `@soec/instancia-pyme`,
 * `@soec/diagnostico`). No es específica de ninguna instancia: compone DETECTAR
 * (hacer visible lo no visto) + ESCLARECER (hacer comprensible una tensión), sin
 * proyectar, orientar ni decidir. El juicio es siempre de la persona.
 */
import type { Attribution } from '@soec/contracts';
import type { DefinicionInput } from '../app/registry';

/** Identificador estable de la capacidad (fuente única). */
export const CAPACIDAD_COMPRENDER_ESTADO_ID = 'comprender-el-estado';

export function definicionComprenderEstado(atribucion: Attribution): DefinicionInput {
  return {
    nombre: 'Comprender el estado',
    proposito:
      'que la persona responsable comprenda el estado actual de su organización y su entorno, con sus tensiones, contradicciones y faltantes visibles',
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
    condicionesEntrada: ['existe un ECE integrado'],
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
