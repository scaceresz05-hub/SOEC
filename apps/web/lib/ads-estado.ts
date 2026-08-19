/**
 * Estado de Google Ads con VERDAD REAL, no la declaración estática del registry.
 *
 * El registry sólo representa CAPACIDAD (proveedor soportado, modo READ_ONLY). La CONEXIÓN real se deriva de
 * evidencia real de credencial/autorización — `googleAdsConfigured` del panel (source + recurso + credenciales
 * app-level presentes). Sin OAuth productivo / credenciales ⇒ NOT_CONNECTED, aunque el registry diga
 * CONNECTED_READ_ONLY. "Capacidad soportada" ≠ "conexión establecida".
 *
 * Los eventos del sitio (medición first-party) son una capacidad INDEPENDIENTE de Google Ads: se evalúan por
 * separado (`midiendoContactos`) y no se ven afectados por el estado de Google Ads.
 */

export interface EstadoAds {
  /** Conexión REAL (hay credencial/autorización productiva), NO la mera declaración del registry. */
  readonly conectado: boolean;
  /** Hay datos reales de campañas en el event-store. */
  readonly conDatos: boolean;
}

/**
 * Deriva el estado desde la EVIDENCIA REAL de conexión (`googleAdsConfigured`: hay source+recurso+credenciales)
 * y si el panel de ads está vacío (datos). El `estado` del registry NO es entrada: no implica conexión.
 */
export function estadoAds(googleAdsConfigured: boolean | undefined, adsVacio: boolean): EstadoAds {
  return { conectado: googleAdsConfigured === true, conDatos: !adsVacio };
}

/** Copy honesto para Marketing/Inicio. 'FRESH' ⇒ hay datos: mostrar métricas reales en su lugar. */
export function copyConexionAds(e: EstadoAds): string {
  if (!e.conectado) return 'Google Ads todavía no está conectado.';
  if (!e.conDatos) return 'Google Ads está conectado, pero todavía no hay datos de campañas disponibles.';
  return 'FRESH';
}

/** Línea de "SOEC está haciendo" en Objetivos: si NO está conectado, no afirma ninguna actividad de Google Ads. */
export function lineaObjetivoAds(e: EstadoAds): { readonly t: string; readonly ok: boolean } {
  if (e.conectado && e.conDatos) return { t: 'Observando tus anuncios de Google Ads', ok: true };
  if (e.conectado) return { t: 'Google Ads conectado; esperando datos de campaña', ok: false };
  return { t: 'Google Ads todavía no está conectado', ok: false };
}

/** Copy de "Por qué" cuando NO hay términos: distingue no-conectado de conectado-sin-datos. */
export function copyPorqueSinTerminos(e: EstadoAds): string {
  if (!e.conectado) return 'Google Ads aún no está conectado. Cuando exista una conexión real y haya datos, SOEC podrá explicar qué búsquedas están generando resultados.';
  return 'Google Ads está conectado, pero aún no hay datos de búsquedas disponibles para explicar una conclusión.';
}

/**
 * ¿Está la medición de contactos del sitio (first-party) realmente activa? Independiente de Google Ads:
 * se demuestra por la presencia de datos de embudo comercial (no por el registry ni por GA4).
 */
export function midiendoContactos(growthComercial: Record<string, number> | undefined): boolean {
  return !!growthComercial && Object.keys(growthComercial).length > 0;
}
