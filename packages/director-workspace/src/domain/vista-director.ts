/**
 * @soec/director-workspace · Vista del ciclo del Director de Marketing Autónomo (Bloque I).
 *
 * EXTIENDE el Director Workspace: no reconstruye motores ni duplica lógica; compone en una sola
 * vista los agregados ya producidos por los Bloques C–H y expone el ciclo gobernado completo:
 * organización activa, objetivo, nivel de autonomía, modo seguro (PAUSA), calidad de
 * evaluabilidad, decisión y su justificación, pendientes, ejecuciones simuladas, bloqueos,
 * resultados, aprendizajes y próxima recomendación.
 *
 * Regla de honestidad: cada dato surfaceado declara su NATURALEZA —REAL, SIMULADO, ESTIMADO o
 * DESCONOCIDO— para que nadie confunda una emulación con un hecho.
 */
import type { EstadoAutonomia } from '@soec/autonomia';
import type { Campania } from '@soec/campanias';
import type { ContenidoGobernado } from '@soec/contenido-gobernado';
import type { EjecucionContenido, RegistroEjecucion } from '@soec/ejecucion-simulada';
import type { ResultadoCampania } from '@soec/medicion';
import type { Aprendizaje } from '@soec/aprendizaje';

export type Naturaleza = 'REAL' | 'SIMULADO' | 'ESTIMADO' | 'DESCONOCIDO';

/** Un valor con su naturaleza declarada. `valor` null cuando no hay dato (DESCONOCIDO). */
export interface Dato<T> {
  readonly valor: T | null;
  readonly naturaleza: Naturaleza;
  readonly nota: string;
}

export interface InsumosVista {
  readonly organizacionActiva: string;
  readonly autonomia: EstadoAutonomia | null;
  readonly objetivo: { readonly texto: string; readonly decisionId: string } | null;
  readonly justificacion: string | null;
  /** Calidad de evaluabilidad: ¿la decisión es evaluable con la evidencia disponible? */
  readonly evaluable: boolean;
  readonly faltantes: readonly string[];
  readonly campanias: readonly Campania[];
  readonly contenidos: readonly ContenidoGobernado[];
  readonly ejecuciones: readonly EjecucionContenido[];
  readonly resultado: ResultadoCampania | null;
  readonly aprendizajes: readonly Aprendizaje[];
}

export interface EjecucionSimuladaVista {
  readonly requestId: string;
  readonly contenidoId: string;
  readonly canal: string;
  readonly resultado: string;
  readonly naturaleza: Naturaleza; // SIEMPRE SIMULADO
}

export interface VistaCicloDirector {
  readonly organizacionActiva: string;
  readonly nivelAutonomia: number;
  readonly modoSeguro: boolean;
  readonly objetivo: Dato<string>;
  readonly justificacion: string | null;
  readonly calidadEvaluabilidad: 'EVALUABLE' | 'NO_EVALUABLE';
  readonly decision: Dato<string>;
  readonly pendientes: readonly string[];
  readonly ejecucionesSimuladas: readonly EjecucionSimuladaVista[];
  readonly bloqueos: readonly string[];
  readonly resultado: Dato<number>; // ROI, con su naturaleza (REAL/SIMULADO/ESTIMADO/DESCONOCIDO)
  readonly aprendizajes: readonly { readonly conclusion: string; readonly reutilizable: boolean }[];
  readonly proximaRecomendacion: string;
}

/**
 * Naturaleza del resultado (ROI) tomada DIRECTAMENTE de la clasificación autoritativa del
 * módulo de medición (una sola fuente de verdad): REAL sólo si todos los componentes lo son.
 */
function naturalezaResultado(r: ResultadoCampania | null): Dato<number> {
  if (!r) return { valor: null, naturaleza: 'DESCONOCIDO', nota: 'aún no hay resultado medido' };
  switch (r.clasificacion) {
    case 'REAL':
      return { valor: r.roiReal, naturaleza: 'REAL', nota: r.motivo };
    case 'SIMULADO':
      return { valor: r.roiEstimado, naturaleza: 'SIMULADO', nota: r.motivo };
    case 'ESTIMADO':
      return { valor: r.roiEstimado, naturaleza: 'ESTIMADO', nota: r.motivo };
    case 'NO_CONCLUYENTE':
    case 'NO_EVALUABLE':
    default:
      return { valor: null, naturaleza: 'DESCONOCIDO', nota: `${r.clasificacion}: ${r.motivo}` };
  }
}

/** Compone la vista del ciclo. Función pura y determinista. */
export function componerVistaDirector(e: InsumosVista): VistaCicloDirector {
  const modoSeguro = e.autonomia?.pausado ?? false;
  const nivelAutonomia = e.autonomia?.nivel ?? 0;

  const objetivo: Dato<string> = e.objetivo
    ? { valor: e.objetivo.texto, naturaleza: 'REAL', nota: `decisión ${e.objetivo.decisionId}` }
    : { valor: null, naturaleza: 'DESCONOCIDO', nota: 'sin objetivo vigente' };

  const decision: Dato<string> = e.objetivo
    ? { valor: e.objetivo.decisionId, naturaleza: 'REAL', nota: 'decisión registrada' }
    : { valor: null, naturaleza: 'DESCONOCIDO', nota: 'sin decisión' };

  const registros: RegistroEjecucion[] = e.ejecuciones.flatMap((x) => [...x.registros]);
  const ejecucionesSimuladas: EjecucionSimuladaVista[] = registros.map((r) => ({
    requestId: r.requestId,
    contenidoId: r.contenidoId,
    canal: r.canal,
    resultado: r.resultado,
    naturaleza: 'SIMULADO',
  }));

  // Pendientes: faltantes de información + contenidos con brief incompleto + campañas sin ejecutar.
  const pendientes: string[] = [
    ...e.faltantes.map((f) => `falta información: ${f}`),
    ...e.contenidos.filter((c) => c.faltantesBrief.length > 0).map((c) => `contenido ${c.contenidoId}: brief incompleto`),
  ];

  // Bloqueos: modo seguro, contenidos rechazados, ejecuciones rechazadas o con fallo permanente.
  const bloqueos: string[] = [];
  if (modoSeguro) bloqueos.push('MODO_SEGURO: sistema en pausa; requiere reanudación humana');
  for (const c of e.contenidos) if (c.estado === 'RECHAZADO') bloqueos.push(`contenido ${c.contenidoId} RECHAZADO: no puede programarse`);
  for (const r of registros) {
    if (r.resultado === 'RECHAZADA') bloqueos.push(`ejecución ${r.requestId} RECHAZADA (${r.escenario})`);
    if (r.resultado === 'FALLIDA_PERMANENTE') bloqueos.push(`ejecución ${r.requestId} con fallo permanente`);
  }

  const aprendizajes = e.aprendizajes
    .filter((a) => a.conclusion)
    .map((a) => ({ conclusion: a.conclusion!.enunciado, reutilizable: a.reutilizable !== null }));

  const resultado = naturalezaResultado(e.resultado);

  return {
    organizacionActiva: e.organizacionActiva,
    nivelAutonomia,
    modoSeguro,
    objetivo,
    justificacion: e.justificacion,
    calidadEvaluabilidad: e.evaluable ? 'EVALUABLE' : 'NO_EVALUABLE',
    decision,
    pendientes,
    ejecucionesSimuladas,
    bloqueos,
    resultado,
    aprendizajes,
    proximaRecomendacion: proximaRecomendacion(e, resultado, modoSeguro),
  };
}

function proximaRecomendacion(e: InsumosVista, resultado: Dato<number>, modoSeguro: boolean): string {
  if (modoSeguro) return 'El sistema está en pausa (modo seguro). Requiere una reanudación humana antes de avanzar.';
  if (!e.evaluable) return `Faltan datos para evaluar (${e.faltantes.join(', ') || 'sin detalle'}). No se recomienda avanzar hasta completarlos.`;
  if (!e.objetivo) return 'Registrar y aprobar una decisión de marketing para derivar una campaña gobernada.';
  if (e.campanias.length === 0) return 'Derivar una campaña gobernada desde la decisión aprobada.';
  if (!e.resultado) return 'Ejecutar (simulado) y medir el resultado de la campaña antes de concluir.';
  if (resultado.naturaleza !== 'REAL') return 'El resultado no es concluyente (simulado/estimado/incompleto). No escalar presupuesto ni generalizar aprendizajes.';
  return 'Resultado concluyente. Considerar consolidar el aprendizaje y, con autorización humana, escalar la inversión.';
}
