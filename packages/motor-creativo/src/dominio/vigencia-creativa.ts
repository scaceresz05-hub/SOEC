/**
 * @soec/motor-creativo · dominio · VIGENCIA CREATIVA canónica (autoridad ÚNICA).
 *
 * La vigencia de un artefacto creativo respecto de M5 se DERIVA (no se cachea como verdad): se comparan
 * las referencias versionadas del artefacto contra el estado ACTUAL de M5. Esta derivación es la única
 * autoridad; los campos `estadoGobernanza`/`vigencia` de los agregados son su materialización (caché
 * honesta que se pone en concordancia vía evento). Función pura y determinista.
 *
 * - OBSOLETO           — alguna referencia cambió de versión o desapareció (retiro incluido: retirar sube versión).
 * - REQUIERE_REVISION  — las versiones coinciden pero alguna referencia dejó de estar sostenida (no VERDADERO).
 * - VIGENTE            — todas las referencias en su versión y sostenidas en VERDADERO.
 */
export type EstadoVigenciaCreativa = 'VIGENTE' | 'REQUIERE_REVISION' | 'OBSOLETO';

export interface RefConEstado {
  readonly afirmacionId: string;
  readonly versionEsperada: number;
  readonly versionActual: number | null;
  readonly estadoActual: string | null;
}

export interface DictamenVigencia {
  readonly estado: EstadoVigenciaCreativa;
  readonly desajustes: readonly RefConEstado[];
  readonly motivo: string;
}

export function evaluarVigencia(refs: readonly RefConEstado[]): DictamenVigencia {
  const cambiadas = refs.filter((r) => r.versionActual === null || r.versionActual !== r.versionEsperada);
  if (cambiadas.length > 0) {
    return { estado: 'OBSOLETO', desajustes: cambiadas, motivo: `${cambiadas.length} referencia(s) de M5 cambiaron de versión o desaparecieron` };
  }
  const degradadas = refs.filter((r) => r.estadoActual !== 'VERDADERO');
  if (degradadas.length > 0) {
    return { estado: 'REQUIERE_REVISION', desajustes: degradadas, motivo: `${degradadas.length} referencia(s) dejaron de estar sostenidas (VERDADERO) en M5` };
  }
  return { estado: 'VIGENTE', desajustes: [], motivo: 'todas las referencias de M5 vigentes y sostenidas' };
}

export function esVigente(d: DictamenVigencia): boolean {
  return d.estado === 'VIGENTE';
}
