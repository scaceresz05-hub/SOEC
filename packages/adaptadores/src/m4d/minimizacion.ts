/**
 * @soec/adaptadores · M4-D (neutral) · MINIMIZACIÓN / TRANSFORMACIÓN de datos antes de salir del dominio
 * (Eje 3 / D-7). Transformaciones DETERMINISTAS y provider-agnósticas; la POLÍTICA concreta (qué campo usa
 * qué transformación) la decide D-2/D-7 y se inyecta como dato, no se decide aquí. Sin red/SDK/reloj/azar.
 *
 * HONESTIDAD: `SEUDONIMIZAR` produce un seudónimo estable por clave inyectada (reversible mediante tabla de
 * correspondencia externa); NO es anonimización irreversible ni una garantía criptográfica. La anonimización
 * real exige política + revisión (D-7), no sólo esta transformación.
 */
export type NombreTransformacion = 'IDENTIDAD' | 'REDACTAR' | 'TRUNCAR' | 'SEUDONIMIZAR' | 'OMITIR';

export interface OpcionesTransformacion {
  readonly longitud?: number; // TRUNCAR
  readonly clave?: string; // SEUDONIMIZAR (clave/sal inyectada; sin ella, seudonimizar falla-cerrado a OMITIR)
}

/** FNV-1a de 32 bits (determinista, sin azar): sólo para seudónimo estable/detección, no firma criptográfica. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Aplica una transformación a un valor. Devuelve el valor transformado, o `null` si el campo debe OMITIRSE
 * (no sale). Fail-closed: `SEUDONIMIZAR` sin `clave` → `null` (se omite en vez de filtrar en claro).
 */
export function transformar(nombre: NombreTransformacion, valor: string, opciones: OpcionesTransformacion = {}): string | null {
  switch (nombre) {
    case 'IDENTIDAD':
      return valor;
    case 'REDACTAR':
      return '[REDACTADO]';
    case 'TRUNCAR': {
      const n = opciones.longitud ?? 0;
      return n > 0 ? valor.slice(0, n) : '';
    }
    case 'SEUDONIMIZAR':
      return opciones.clave ? `seud_${fnv1a(`${opciones.clave}:${valor}`)}` : null;
    case 'OMITIR':
      return null;
    default:
      return null; // fail-closed ante transformación desconocida
  }
}
