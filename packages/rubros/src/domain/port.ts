/**
 * @soec/rubros · dominio · frontera estable de consulta (RubroKnowledgePort).
 *
 * El motor consume conocimiento por consultas de dominio, NO por la estructura física
 * de la biblioteca (criterio 3). `crearBiblioteca` es genérico: recibe cualquier
 * RubroKnowledge y devuelve un puerto — sin condiciones por slug de rubro (criterio 7).
 *
 * Política de madurez (criterio 2): por defecto solo se ofrece conocimiento RATIFIED;
 * `INCLUIR_PRELIMINAR` añade PRELIMINARY cuando el consumidor lo pide expresamente.
 * DRAFT y DEPRECATED NUNCA aparecen en las consultas de elegibilidad. La capa
 * regulatoria tiene una consulta separada que incluye PRELIMINARY como advertencia
 * conservadora, sin alterar la elegibilidad de objetivos ni estrategias.
 */
import type {
  RubroKnowledge,
  EstadoMadurez,
  Objetivo,
  Estrategia,
  Metrica,
  Embudo,
  Supuesto,
  RestriccionGeneral,
  Regulatorio,
  Senal,
  Mapeo,
} from './tipos';
import { validarBiblioteca, BibliotecaInvalidaError } from './validacion';
import { huellaCompleta, huellaCorta } from './huella';

/** Política de selección por madurez. Por defecto, `SOLO_RATIFICADO`. */
export type PoliticaMadurez = 'SOLO_RATIFICADO' | 'INCLUIR_PRELIMINAR';

const PERMITIDOS: Readonly<Record<PoliticaMadurez, readonly EstadoMadurez[]>> = {
  SOLO_RATIFICADO: ['RATIFIED'],
  INCLUIR_PRELIMINAR: ['RATIFIED', 'PRELIMINARY'],
};

export interface VersionBiblioteca {
  /** Versión de la biblioteca (distinta de la versión de cada entrada). */
  readonly biblioteca: string;
  /** Huella SHA-256 completa (64 hex): identidad técnica y de auditoría. */
  readonly huellaCompleta: string;
  /** Forma abreviada (12 hex), solo para presentación. */
  readonly huellaCorta: string;
}

export interface RubroKnowledgePort {
  rubroId(): string;
  version(): VersionBiblioteca;
  /** Objetivos elegibles. Por defecto SOLO_RATIFICADO; nunca DRAFT ni DEPRECATED. */
  objetivosElegibles(politica?: PoliticaMadurez): readonly Objetivo[];
  /** Estrategias que atienden un objetivo. Por defecto SOLO_RATIFICADO. */
  estrategiasDe(objetivoId: string, politica?: PoliticaMadurez): readonly Estrategia[];
  metricas(politica?: PoliticaMadurez): readonly Metrica[];
  embudos(politica?: PoliticaMadurez): readonly Embudo[];
  supuestos(politica?: PoliticaMadurez): readonly Supuesto[];
  restriccionesGenerales(politica?: PoliticaMadurez): readonly RestriccionGeneral[];
  /**
   * Restricciones regulatorias como advertencias conservadoras: incluye RATIFIED y
   * PRELIMINARY (nunca DRAFT/DEPRECATED). No certifica cumplimiento (ver semanticaRegulatoria).
   */
  restriccionesRegulatorias(): readonly Regulatorio[];
  /** Preguntas del diagnóstico (capa de producto). */
  preguntasDiagnosticas(): readonly string[];
  /** Señales diagnósticas RATIFIED (con su condición de activación). */
  senales(): readonly Senal[];
  /** Mapeos causales RATIFIED (señal → objetivo → estrategia). */
  mapeos(): readonly Mapeo[];
}

export function crearBiblioteca(data: RubroKnowledge): RubroKnowledgePort {
  const v = validarBiblioteca(data);
  if (!v.valido) throw new BibliotecaInvalidaError(v.errores);
  const completa = huellaCompleta(data);
  const corta = huellaCorta(completa);

  const filtrar = <T extends { readonly estado: EstadoMadurez }>(
    xs: readonly T[],
    politica: PoliticaMadurez,
  ): readonly T[] => xs.filter((x) => PERMITIDOS[politica].includes(x.estado));

  return {
    rubroId: () => data.rubroId,
    version: () => ({ biblioteca: data.version, huellaCompleta: completa, huellaCorta: corta }),

    objetivosElegibles: (politica = 'SOLO_RATIFICADO') => filtrar(data.objetivos, politica),

    estrategiasDe: (objetivoId, politica = 'SOLO_RATIFICADO') =>
      filtrar(data.estrategias, politica).filter((e) => e.atiende.includes(objetivoId)),

    metricas: (politica = 'SOLO_RATIFICADO') => filtrar(data.metricas, politica),

    embudos: (politica = 'SOLO_RATIFICADO') => filtrar(data.embudos, politica),

    supuestos: (politica = 'SOLO_RATIFICADO') => filtrar(data.supuestos, politica),

    restriccionesGenerales: (politica = 'SOLO_RATIFICADO') =>
      filtrar(data.restriccionesGenerales, politica),

    restriccionesRegulatorias: () =>
      data.regulatorio.filter((r) => r.estado === 'RATIFIED' || r.estado === 'PRELIMINARY'),

    preguntasDiagnosticas: () => {
      const p = data.producto.find((x) => x.clave === 'preguntas_diagnosticas');
      return p?.preguntas ?? [];
    },

    senales: () => data.senales.filter((s) => s.estado === 'RATIFIED'),

    mapeos: () => data.mapeos.filter((m) => m.estado === 'RATIFIED'),
  };
}
