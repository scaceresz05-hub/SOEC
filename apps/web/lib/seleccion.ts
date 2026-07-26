/**
 * Reconciliación de la selección (organización/departamento) contra el catálogo gobernado.
 *
 * Regla de integridad: la interfaz NUNCA debe mostrar una organización mientras internamente
 * mantiene otra. Un par proveniente de la URL solo se usa cuando la organización existe en el
 * catálogo Y el departamento pertenece a esa organización; en cualquier otro caso se cae al
 * primer par gobernado válido. Lógica pura (sin React/DOM) para poder probarla en aislamiento.
 */
import type { Catalogo } from './evaluacion-types';

export interface Par {
  org: string;
  dep: string;
}
export interface Reconciliacion extends Par {
  /** true si el par de entrada era inválido/obsoleto y se sustituyó por uno gobernado. */
  reconciliado: boolean;
}

/** Primer par gobernado del catálogo (o vacío si el catálogo aún no está disponible). */
export function primerPar(cat: Catalogo | null): Par {
  const o = cat?.organizaciones[0];
  return { org: o?.id ?? '', dep: o?.departamentos[0]?.id ?? '' };
}

/** ¿La organización existe y el departamento pertenece a ella? */
export function esParValido(cat: Catalogo | null, org: string, dep: string): boolean {
  const o = cat?.organizaciones.find((x) => x.id === org);
  return !!o && o.departamentos.some((d) => d.id === dep);
}

/**
 * Reconcilia (org, dep) provenientes de la URL contra el catálogo:
 * - par válido → se conserva (`reconciliado=false`);
 * - org válida + dep inválido → primer departamento de esa org (`reconciliado=true`);
 * - org inválida/ausente → primer par gobernado (`reconciliado=true`).
 */
export function reconciliar(
  cat: Catalogo | null,
  orgUrl: string | null,
  depUrl: string | null,
): Reconciliacion {
  if (!cat || cat.organizaciones.length === 0) return { org: '', dep: '', reconciliado: false };
  const o = cat.organizaciones.find((x) => x.id === orgUrl);
  if (o) {
    if (depUrl && o.departamentos.some((d) => d.id === depUrl)) {
      return { org: o.id, dep: depUrl, reconciliado: false };
    }
    return { org: o.id, dep: o.departamentos[0]?.id ?? '', reconciliado: true };
  }
  return { ...primerPar(cat), reconciliado: true };
}
