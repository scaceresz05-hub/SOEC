/**
 * @soec/adaptadores · dominio · INMUTABILIDAD (M4-C-A-H, C-5). Clonado y congelado profundos para que:
 *  - el adaptador NO pueda mutar la entrada del sandbox (se le entrega una copia congelada);
 *  - el consumidor NO pueda mutar el resultado ni la evidencia devueltos (van congelados).
 *
 * Sólo admite datos serializables simples (primitivos, arrays y objetos planos). Rechaza explícitamente
 * tipos mutables/no soportados (Function/Map/Set/Date/typed arrays/prototipos arbitrarios) y referencias
 * circulares — un adaptador no puede colar estructuras peligrosas en el resultado gobernado.
 */
import { AdaptadorInvalidoError } from './errores-normalizados';

function esObjetoPlano(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Clona en profundidad valores serializables simples; lanza `AdaptadorInvalidoError` ante lo no soportado. */
export function clonarProfundo<T>(valor: T, vistos: WeakSet<object> = new WeakSet()): T {
  if (valor === null || typeof valor === 'undefined') return valor;
  const t = typeof valor;
  if (t === 'string' || t === 'number' || t === 'boolean') return valor;
  if (t === 'bigint' || t === 'symbol' || t === 'function') {
    throw new AdaptadorInvalidoError(`tipo no soportado en dato gobernado: ${t}`);
  }
  // `vistos` rastrea sólo los ANCESTROS del camino actual: se agrega al entrar y se quita al salir, de modo
  // que una referencia compartida no circular (diamante/DAG) es válida y sólo una circular real falla.
  if (Array.isArray(valor)) {
    if (vistos.has(valor)) throw new AdaptadorInvalidoError('referencia circular en dato gobernado');
    vistos.add(valor);
    const salida = valor.map((x) => clonarProfundo(x, vistos));
    vistos.delete(valor);
    return salida as unknown as T;
  }
  if (t === 'object') {
    const obj = valor as object;
    if (!esObjetoPlano(obj)) throw new AdaptadorInvalidoError('objeto no plano (prototipo arbitrario) en dato gobernado');
    if (vistos.has(obj)) throw new AdaptadorInvalidoError('referencia circular en dato gobernado');
    vistos.add(obj);
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) salida[k] = clonarProfundo(v, vistos);
    vistos.delete(obj);
    return salida as T;
  }
  throw new AdaptadorInvalidoError(`tipo no soportado en dato gobernado: ${t}`);
}

/** Congela en profundidad un valor ya clonado. */
export function congelarProfundo<T>(valor: T): T {
  if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor as Record<string, unknown>)) congelarProfundo(v);
    Object.freeze(valor);
  }
  return valor;
}

/** Clona y congela: copia defensiva inmutable de un dato gobernado. */
export function blindar<T>(valor: T): T {
  return congelarProfundo(clonarProfundo(valor));
}
