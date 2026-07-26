/**
 * @soec/rubros · dominio · huella determinista de una biblioteca de rubro.
 *
 * Mismo contenido canónico → misma huella, sin depender del orden accidental de las
 * colecciones, de timestamps de ejecución ni de rutas locales. La canonicalización
 * ordena las colecciones por `id` y las claves de objeto, e incluye ÚNICAMENTE el
 * contenido declarado de la biblioteca (nada transitorio: sin fechas de ejecución,
 * rutas ni metadatos del entorno). Sobre ese texto canónico se aplica SHA-256
 * estándar; la identidad técnica y de auditoría conserva la huella completa (64 hex).
 */
import { createHash } from 'node:crypto';
import type { RubroKnowledge } from './tipos';

function porId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Normaliza: ordena las colecciones por id y ordena el conjunto `atiende`. */
function normalizar(d: RubroKnowledge): unknown {
  return {
    rubroId: d.rubroId,
    version: d.version,
    objetivos: [...d.objetivos].sort(porId),
    estrategias: [...d.estrategias]
      .map((e) => ({
        ...e,
        atiende: [...e.atiende].sort(),
        activadores: [...e.activadores].sort(),
      }))
      .sort(porId),
    metricas: [...d.metricas].sort(porId),
    embudos: [...d.embudos].sort(porId),
    restriccionesGenerales: [...d.restriccionesGenerales].sort(porId),
    supuestos: [...d.supuestos].sort(porId),
    regulatorio: [...d.regulatorio]
      .map((r) => ({ ...r, observa: [...r.observa].sort() }))
      .sort(porId),
    producto: [...d.producto].sort(porId),
    senales: [...d.senales].sort(porId),
    mapeos: [...d.mapeos].sort(porId),
  };
}

/** Serialización canónica: claves de objeto ordenadas; orden de arrays preservado. */
function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Representación canónica en texto (determinista; útil para comparar/depurar). */
export function canonicalizar(d: RubroKnowledge): string {
  return canon(normalizar(d));
}

/** Huella SHA-256 completa (64 caracteres hex). Identidad técnica y de auditoría. */
export function huellaCompleta(d: RubroKnowledge): string {
  return createHash('sha256').update(canonicalizar(d), 'utf8').digest('hex');
}

/** Forma abreviada, SOLO para presentación (primeros 12 hex). */
export function huellaCorta(completa: string): string {
  return completa.slice(0, 12);
}
