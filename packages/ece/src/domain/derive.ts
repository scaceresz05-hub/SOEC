/**
 * Derivación DETERMINÍSTICA y auditable de elementos del ECE a partir del estado
 * de un modelo (MED o MDM). No infiere semánticamente ni decide: solo hace
 * explícita la estructura ya declarada entre afirmaciones y evidencia.
 *
 * - coherencia: afirmación respaldada, sostenida por evidencia, sin evidencia que la debilite.
 * - contradicción: afirmación con evidencia que a la vez la sostiene y la debilita (conflicto).
 * - ausencia: afirmación pendiente sin evidencia (o solo inconclusa) → queda NO EVALUABLE.
 *
 * La integración no eleva la certeza (#12 inv. 3): cada elemento hereda la
 * incertidumbre, la atribución y las limitaciones de su fuente.
 */
import type { ModelInstanceState, ModelType } from '@soec/models';
import type { ElementoEce, RefModelo, TipoElemento } from './ece';

function refAfirmacion(modelo: ModelType, instanceId: string, afirmacionId: string): RefModelo {
  return { modelo, instanceId, elementoId: afirmacionId, elementoTipo: 'afirmacion' };
}

function idDerivado(tipo: TipoElemento, modelo: ModelType, instanceId: string, afirmacionId: string): string {
  return `der:${tipo}:${modelo}:${instanceId}:${afirmacionId}`;
}

/** Deriva los elementos intra-modelo del estado dado. Reproducible: mismas entradas → mismos ids. */
export function derivarDeModelo(state: ModelInstanceState): ElementoEce[] {
  const salida: ElementoEce[] = [];
  const modelo = state.modelType;
  const proc = `${modelo}:${state.instanceId}@v${state.version}`;

  for (const af of Object.values(state.afirmaciones)) {
    const evid = Object.values(state.evidencias).filter((e) => e.afirmacionId === af.id);
    const sostiene = evid.filter((e) => e.relacion === 'sostiene');
    const debilita = evid.filter((e) => e.relacion === 'debilita');
    const inconclusa = evid.filter((e) => e.relacion === 'inconclusa');
    const evidIds = evid.map((e) => e.id);
    const limitaciones = af.limitacion ? [af.limitacion] : [];

    const comun = {
      origen: 'derivado' as const,
      referencias: [refAfirmacion(modelo, state.instanceId, af.id)],
      procedencia: `${proc} afirmación ${af.id} (fuente: ${af.atribucion.source})`,
      evidencia: evidIds,
      alcance: af.dimension,
      vigencia: state.vigencia,
      atribucion: af.atribucion,
      incertidumbre: af.incertidumbre,
      limitaciones,
      estadoRevision: 'vigente' as const,
      estadoSatisfaccion: null,
      historial: [],
    };

    if (sostiene.length > 0 && debilita.length > 0) {
      // Contradicción de primera clase: NO se resuelve automáticamente (§8).
      salida.push({
        ...comun,
        id: idDerivado('contradiccion', modelo, state.instanceId, af.id),
        tipo: 'contradiccion',
        noEvaluable: false,
      });
      continue;
    }
    if (af.estado === 'respaldada' && sostiene.length > 0 && debilita.length === 0) {
      salida.push({
        ...comun,
        id: idDerivado('coherencia', modelo, state.instanceId, af.id),
        tipo: 'coherencia',
        noEvaluable: false,
      });
      continue;
    }
    if (af.estado === 'pendiente' && (evid.length === 0 || evid.length === inconclusa.length)) {
      // La ausencia de información es información (§9): el elemento queda no evaluable.
      salida.push({
        ...comun,
        id: idDerivado('ausencia', modelo, state.instanceId, af.id),
        tipo: 'ausencia',
        limitaciones: [...limitaciones, 'evidencia faltante o inconclusa'],
        noEvaluable: true,
      });
    }
  }
  return salida;
}

/** Deriva los elementos de ambos modelos (intra-MED y intra-MDM). */
export function derivarElementos(med: ModelInstanceState, mdm: ModelInstanceState): ElementoEce[] {
  return [...derivarDeModelo(med), ...derivarDeModelo(mdm)];
}
