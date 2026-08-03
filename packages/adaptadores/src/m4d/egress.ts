/**
 * @soec/adaptadores · M4-D (neutral) · POLÍTICA DE SALIDA DE DATOS (egress, Eje 2). Lista blanca CERRADA y
 * TIPADA por operación: sólo salen los campos declarados, con su transformación de minimización; TODO lo no
 * declarado se descarta (default-deny). Motor provider-agnóstico: la lista concreta de campos por capacidad
 * la decide D-2 y se inyecta como `EsquemaSalida` (dato), no se decide aquí. Sin red/SDK/reloj/azar.
 */
import { type NombreTransformacion, type OpcionesTransformacion, transformar } from './minimizacion';

export interface CampoSalida {
  readonly nombre: string;
  readonly tipo: 'string' | 'number' | 'boolean';
  readonly transformacion?: NombreTransformacion; // por defecto IDENTIDAD
  readonly opciones?: OpcionesTransformacion;
}

export interface EsquemaSalida {
  readonly operacion: string;
  readonly campos: readonly CampoSalida[]; // lista blanca cerrada
}

export interface ResultadoEgress {
  readonly permitido: boolean;
  /** Datos que efectivamente pueden salir (sólo campos declarados y transformados; en claro NUNCA lo omitido). */
  readonly datos: Readonly<Record<string, string>>;
  /** Campos presentes en la entrada pero NO declarados en el esquema (descartados por default-deny). */
  readonly descartados: readonly string[];
  /** Campos declarados pero con tipo inválido o transformación fallida (fail-closed). */
  readonly rechazados: readonly string[];
  readonly motivo: string;
}

function tipoValido(tipo: CampoSalida['tipo'], v: unknown): boolean {
  return typeof v === tipo;
}

/**
 * Filtra los datos de entrada contra el esquema (default-deny). Devuelve sólo los campos declarados,
 * transformados/minimizados; enumera lo descartado (no declarado) y lo rechazado (tipo/transf. inválidos).
 * Un campo rechazado NO sale. `permitido` es true si no hubo rechazos de campos declarados.
 */
export function validarEgress(esquema: EsquemaSalida, entrada: Readonly<Record<string, unknown>>): ResultadoEgress {
  const declarados = new Set(esquema.campos.map((c) => c.nombre));
  const descartados = Object.keys(entrada).filter((k) => !declarados.has(k)).sort();
  const datos: Record<string, string> = {};
  const rechazados: string[] = [];

  for (const campo of esquema.campos) {
    const v = entrada[campo.nombre];
    if (v === undefined) continue; // ausente: simplemente no sale
    if (!tipoValido(campo.tipo, v)) {
      rechazados.push(campo.nombre);
      continue;
    }
    const t = transformar(campo.transformacion ?? 'IDENTIDAD', String(v), campo.opciones ?? {});
    if (t === null) continue; // OMITIR o seudonimización sin clave: no sale (no es rechazo, es minimización)
    datos[campo.nombre] = t;
  }

  return {
    permitido: rechazados.length === 0,
    datos,
    descartados,
    rechazados: rechazados.sort(),
    motivo: rechazados.length === 0 ? '' : `campos con tipo/transformación inválidos: ${rechazados.join(', ')}`,
  };
}
