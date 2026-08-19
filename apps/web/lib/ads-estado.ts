/**
 * Estado de Google Ads separado en CONEXIÓN (registro de la fuente) vs DATOS (event-store). Una sola fuente
 * de verdad para el copy de /negocios (Marketing/Inicio/Objetivos/Por qué), coherente con Preparación.
 * "Conectado sin datos" NUNCA se muestra como "no conectado". No se afirma actividad sobre datos inexistentes.
 */

export interface EstadoAds {
  /** La fuente está conectada/autorizada (según el registro), independiente de si hay métricas. */
  readonly conectado: boolean;
  /** Hay datos reales de campañas en el event-store. */
  readonly conDatos: boolean;
}

/** Deriva el estado desde el `estado` de la fuente (registro) y si el panel de ads está vacío (datos). */
export function estadoAds(estadoFuente: string | undefined, adsVacio: boolean): EstadoAds {
  return { conectado: estadoFuente === 'CONNECTED_READ_ONLY', conDatos: !adsVacio };
}

/** Copy honesto para Marketing/Inicio. 'FRESH' ⇒ hay datos: mostrar métricas reales en su lugar. */
export function copyConexionAds(e: EstadoAds): string {
  if (!e.conectado) return 'Google Ads todavía no está conectado.';
  if (!e.conDatos) return 'Google Ads está conectado, pero todavía no hay datos de campañas disponibles.';
  return 'FRESH';
}

/** Línea de "SOEC está haciendo" en Objetivos: sólo afirma "observando" si conectado Y con datos. */
export function lineaObjetivoAds(e: EstadoAds): { readonly t: string; readonly ok: boolean } {
  if (e.conectado && e.conDatos) return { t: 'Observando tus anuncios de Google Ads', ok: true };
  if (e.conectado) return { t: 'Google Ads conectado; esperando datos de campaña', ok: false };
  return { t: 'Google Ads todavía no está conectado', ok: false };
}

/** Copy de "Por qué" cuando NO hay términos de búsqueda: distingue no-conectado de conectado-sin-datos. */
export function copyPorqueSinTerminos(e: EstadoAds): string {
  if (!e.conectado) return 'Google Ads aún no está conectado, así que todavía no hay búsquedas de dónde leer una conclusión.';
  return 'Google Ads está conectado, pero aún no hay datos de búsquedas disponibles para explicar una conclusión.';
}
