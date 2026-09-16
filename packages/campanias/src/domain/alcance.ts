/**
 * @soec/campanias · dominio · ALCANCE GEOGRÁFICO de una campaña.
 *
 * SOEC no tenía un campo territorial oficial para campañas: el territorio vivía como texto suelto
 * (`territorio: 'CL'` en briefs de contenido, una sola `comuna` en el plan de Meta, `base` en el perfil
 * de la organización). Un texto no se puede verificar, y sobre todo no impide que un alcance se amplíe
 * sin que nadie lo decida. Este tipo es genérico —no pertenece a ninguna organización— y se valida en
 * dominio.
 *
 * Dos decisiones deliberadas:
 *
 *  1. El alcance se expresa SIEMPRE a nivel de comuna. Un nombre de región o de país no es un territorio
 *     segmentable: `{ region: 'Región del Maule', comunas: [] }` se rechaza. Así "ampliar a la región"
 *     nunca puede ocurrir por omisión; tendría que escribirse comuna por comuna.
 *
 *  2. El criterio de ubicación es `PRESENCIA`: personas ubicadas o habitualmente presentes en las
 *     comunas, nunca personas que sólo mostraron interés por ellas. Es la única opción del tipo a
 *     propósito: la segmentación por interés dispersa el alcance fuera del territorio.
 */

export type CriterioUbicacion = 'PRESENCIA';

export interface AlcanceGeografico {
  readonly pais: string;
  readonly region: string;
  /** Provincia (o unidad equivalente). `null` si el alcance no se agrupa por provincia. */
  readonly provincia: string | null;
  /** Comunas incluidas. Nunca vacío: es el nivel al que se segmenta. */
  readonly comunas: readonly string[];
  readonly criterioUbicacion: CriterioUbicacion;
}

/** Normaliza para comparar: sin mayúsculas, sin tildes y sin espacios sobrantes. */
export function normalizarToponimo(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Errores estructurales del alcance. Lista vacía ⇒ válido. */
export function validarAlcanceGeografico(a: AlcanceGeografico): string[] {
  const e: string[] = [];
  if (!a.pais?.trim()) e.push('alcance_sin_pais');
  if (!a.region?.trim()) e.push('alcance_sin_region');
  if (a.provincia !== null && !a.provincia.trim()) e.push('alcance_provincia_vacia');
  if (!Array.isArray(a.comunas) || a.comunas.length === 0) e.push('alcance_sin_comunas');
  else {
    if (a.comunas.some((c) => !c?.trim())) e.push('alcance_comuna_vacia');
    const vistas = new Set<string>();
    for (const c of a.comunas) {
      const n = normalizarToponimo(c ?? '');
      if (vistas.has(n)) e.push(`alcance_comuna_duplicada:${c}`);
      vistas.add(n);
    }
  }
  if (a.criterioUbicacion !== 'PRESENCIA') e.push('alcance_criterio_ubicacion_no_admitido');
  return e;
}

/**
 * Comunas de `alcance` que NO pertenecen a `permitido`, y si país/región/provincia difieren. Sirve para
 * exigir que una campaña no se salga del alcance comercial declarado por su organización.
 */
export function fueraDeAlcance(alcance: AlcanceGeografico, permitido: AlcanceGeografico): string[] {
  const e: string[] = [];
  if (normalizarToponimo(alcance.pais) !== normalizarToponimo(permitido.pais)) e.push(`pais:${alcance.pais}`);
  if (normalizarToponimo(alcance.region) !== normalizarToponimo(permitido.region)) e.push(`region:${alcance.region}`);
  if (permitido.provincia !== null) {
    if (alcance.provincia === null || normalizarToponimo(alcance.provincia) !== normalizarToponimo(permitido.provincia)) {
      e.push(`provincia:${alcance.provincia ?? '(ninguna)'}`);
    }
  }
  const admitidas = new Set(permitido.comunas.map(normalizarToponimo));
  for (const c of alcance.comunas) if (!admitidas.has(normalizarToponimo(c))) e.push(`comuna:${c}`);
  return e;
}

/** Texto canónico del alcance: «Provincia de Curicó, Región del Maule, Chile». */
export function describirAlcance(a: AlcanceGeografico): string {
  return [a.provincia, a.region, a.pais].filter((x): x is string => Boolean(x && x.trim())).join(', ');
}
