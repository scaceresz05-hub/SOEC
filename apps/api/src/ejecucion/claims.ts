/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · validación de afirmaciones (función pura).
 *
 * Antes de publicar un texto en nombre de una empresa hay que comprobar que la empresa puede decirlo. Esto
 * ocurre ANTES de crear nada: publicar primero y revisar después significa que el anuncio ya se mostró.
 *
 * Se valida contra lo que el negocio declaró (Fase A/D):
 *   · `PROHIBITED_CLAIM`  lo que NO puede afirmar («no atendemos Fonasa») ⇒ bloquea;
 *   · `RESTRICTION`       lo que no ofrece («no hacemos urgencias») ⇒ bloquea si el anuncio lo promete;
 *   · `APPROVED_CLAIM`    lo que sí puede afirmar ⇒ nunca bloquea, aunque comparta palabras con una restricción.
 *
 * El orden importa: una afirmación aprobada explícitamente gana sobre la coincidencia léxica con una
 * restricción. Si no, «urgencias dentales sin espera» quedaría bloqueado por la palabra «urgencias» aunque el
 * negocio la hubiese aprobado después.
 */
import type { RestriccionNegocio } from '../negocio/negocio-pg';
import { terminosDeRestriccion } from '../investigacion/intencion';
import { normalizarTexto } from './ejecucion-tipos';

export interface ConflictoDeClaim {
  readonly donde: string;
  readonly texto: string;
  readonly restriccion: string;
  readonly tipo: string;
  readonly coincidencia: string;
}

export interface ResultadoClaims {
  readonly ok: boolean;
  readonly conflictos: readonly ConflictoDeClaim[];
  /** Cuántos textos se revisaron: sirve para demostrar que la validación no se saltó. */
  readonly revisados: number;
}

/** Las palabras de una afirmación APROBADA no pueden usarse para bloquear un anuncio. */
function palabrasAprobadas(restricciones: readonly RestriccionNegocio[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of restricciones) {
    if (r.tipo !== 'APPROVED_CLAIM') continue;
    for (const p of terminosDeRestriccion(r.texto)) out.add(p);
  }
  return out;
}

/**
 * Valida todos los textos que se publicarían. Devuelve TODOS los conflictos (no sólo el primero): quien tenga
 * que corregir los anuncios merece ver la lista completa, no descubrirlos de uno en uno.
 */
export function validarClaims(
  textos: readonly { readonly donde: string; readonly texto: string }[],
  restricciones: readonly RestriccionNegocio[],
): ResultadoClaims {
  const aprobadas = palabrasAprobadas(restricciones);
  const prohibiciones = restricciones.filter((r) => r.tipo === 'PROHIBITED_CLAIM' || r.tipo === 'RESTRICTION');
  const conflictos: ConflictoDeClaim[] = [];

  for (const t of textos) {
    const plano = normalizarTexto(t.texto);
    for (const r of prohibiciones) {
      const claves = terminosDeRestriccion(r.texto).filter((c) => !aprobadas.has(c));
      const coincidencia = claves.find((c) => plano.includes(c));
      if (coincidencia !== undefined) {
        conflictos.push({ donde: t.donde, texto: t.texto, restriccion: r.texto, tipo: r.tipo, coincidencia });
      }
    }
  }
  return { ok: conflictos.length === 0, conflictos, revisados: textos.length };
}

/** Frase para la interfaz: qué hay que cambiar y por qué, sin jerga. */
export function explicarConflicto(c: ConflictoDeClaim): string {
  return `«${c.texto}» (${c.donde}) menciona «${c.coincidencia}», y tu empresa declaró: «${c.restriccion}».`;
}
