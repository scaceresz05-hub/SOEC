/**
 * apps/api · CAPA DE COMPOSICIÓN · EXECUTOR en DRY-RUN. PURO. NUNCA envía un `mutate`.
 *
 * Dado una intención (idealmente ya "aprobada"), SIMULA exactamente qué se habría ejecutado y describe el
 * antes/después, la verificación (read-back) que se haría y el rollback previsto. En G1 `ejecutado` es SIEMPRE
 * false: el Executor REAL (que llamaría `googleAds:mutate`) es otro componente separado, gateado por
 * AUTONOMOUS_REAL, y NO existe todavía. Aquí no hay red, ni credenciales de escritura, ni efecto externo.
 */
import type { IntencionDeCambio } from './intencion';
import type { ResultadoGates } from './gates';

export interface SimulacionEjecucion {
  readonly ejecutado: false; // invariante de G1: jamás true
  readonly modo: 'DRY_RUN';
  readonly bloqueadoPor: readonly string[]; // gates que impedirían la ejecución real (en G1 incluye el maestro)
  readonly mutateSimulado: string; // lo que se HABRÍA enviado (descripción, no se envía)
  readonly antes: string;
  readonly despues: string;
  readonly verificacionSimulada: { readonly pasos: readonly string[]; readonly resultadoEsperado: string; readonly verificado: boolean };
  readonly rollback: { readonly mutateSimulado: string; readonly descripcion: string };
}

/** Simula la ejecución de una intención SIN efecto externo. Determinista. */
export function simularEjecucion(intencion: IntencionDeCambio, gates: ResultadoGates): SimulacionEjecucion {
  return {
    ejecutado: false,
    modo: 'DRY_RUN',
    bloqueadoPor: gates.bloqueos,
    mutateSimulado: intencion.detalleTecnico.descripcionMutate,
    antes: intencion.valorAntes,
    despues: intencion.valorDespues,
    verificacionSimulada: {
      pasos: [
        'volver a leer la campaña con el conector READ ONLY (searchStream)',
        `confirmar que el cambio "${intencion.recomendacion}" quedó aplicado tal cual`,
        'si el estado real no coincide con la intención ⇒ rollback automático',
      ],
      resultadoEsperado: intencion.valorDespues,
      verificado: true, // en dry-run se asume verificación exitosa (no hay estado real que leer)
    },
    rollback: {
      mutateSimulado: `INVERSO de: ${intencion.detalleTecnico.descripcionMutate}`,
      descripcion: intencion.rollbackPrevisto,
    },
  };
}
