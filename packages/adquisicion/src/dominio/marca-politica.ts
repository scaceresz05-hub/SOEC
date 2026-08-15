/**
 * BrandPolicy + ClaimsPolicy — la política de marca y de afirmaciones, por negocio.
 *
 * Provider-neutral y POR NEGOCIO: la política de SmileFlow (clínica) jamás se copia a C Y P
 * (distribuidora). Reglas duras:
 *   · sin BrandPolicy definida ⇒ NO autopublicación: todo queda en DRAFT_ONLY;
 *   · las afirmaciones no verificadas se bloquean; para negocios médicos/dentales no se inventan
 *     beneficios clínicos ni se prometen resultados; para insumos (C Y P) no se transforma una
 *     ficha de producto en una afirmación médica no demostrada.
 * Este módulo NO reimplementa el validador de afirmaciones existente (`validarContenidoComercial`
 * en `@soec/estrategia-creativa`): define la POLÍTICA por-negocio que ese validador consumirá.
 */

export interface PoliticaMarca {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly tono: readonly string[];
  readonly ctasAprobados: readonly string[];
  readonly afirmacionesAprobadas: readonly string[];
  readonly afirmacionesProhibidas: readonly string[];
  readonly disclaimersObligatorios: readonly string[];
  readonly temasProhibidos: readonly string[];
  /** Temas que, si aparecen, exigen aprobación humana aunque la autonomía esté habilitada. */
  readonly temasAprobacionManual: readonly string[];
  readonly version: number;
}

/**
 * Familias de afirmación reguladas que NUNCA se emiten sin respaldo explícito en la política del
 * negocio. Alineadas con el validador `validarContenidoComercial` existente.
 */
export type FamiliaClaim =
  | 'PROMESA_CLINICA'
  | 'PROMESA_FINANCIERA'
  | 'PRECIO'
  | 'DESCUENTO'
  | 'GARANTIA'
  | 'SUPERLATIVO'
  | 'PRUEBA_SOCIAL'
  | 'CERTIFICACION';

export interface PoliticaClaims {
  readonly organizationId: string;
  /** Familias que este negocio puede usar SÓLO si aparecen en `afirmacionesAprobadas`. */
  readonly familiasReguladas: readonly FamiliaClaim[];
  /** Familias vetadas por completo para este negocio (p. ej. PROMESA_CLINICA para una distribuidora). */
  readonly familiasVetadas: readonly FamiliaClaim[];
}

export type ResultadoAutopublicacion =
  | { readonly permite: 'DRAFT_ONLY'; readonly motivo: 'SIN_BRAND_POLICY' }
  | { readonly permite: 'DRAFT_ONLY'; readonly motivo: 'TEMA_REQUIERE_APROBACION'; readonly tema: string }
  | { readonly permite: 'AUTOPUBLICABLE' };

/**
 * Decide si un contenido, dado su conjunto de temas, puede autopublicarse bajo la política.
 * Sin política ⇒ DRAFT_ONLY. Un tema en `temasAprobacionManual` ⇒ DRAFT_ONLY.
 */
export function evaluarAutopublicacion(
  politica: PoliticaMarca | null,
  temas: readonly string[],
): ResultadoAutopublicacion {
  if (politica === null) return { permite: 'DRAFT_ONLY', motivo: 'SIN_BRAND_POLICY' };
  const temaManual = temas.find((t) => politica.temasAprobacionManual.includes(t));
  if (temaManual !== undefined) {
    return { permite: 'DRAFT_ONLY', motivo: 'TEMA_REQUIERE_APROBACION', tema: temaManual };
  }
  return { permite: 'AUTOPUBLICABLE' };
}

/** ¿La familia de afirmación está vetada o no aprobada para este negocio? */
export function claimBloqueado(
  politica: PoliticaMarca,
  claims: PoliticaClaims,
  familia: FamiliaClaim,
  textoAfirmacion: string,
): boolean {
  if (claims.familiasVetadas.includes(familia)) return true;
  if (claims.familiasReguladas.includes(familia)) {
    return !politica.afirmacionesAprobadas.includes(textoAfirmacion);
  }
  return false;
}
