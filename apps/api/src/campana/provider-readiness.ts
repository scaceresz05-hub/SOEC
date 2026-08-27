/**
 * apps/api · campana · READINESS del GATE EXTERNO de Google Ads (PURO). El gate externo de EJECUCIÓN debe reflejar
 * la CONEXIÓN OAuth REAL (CONNECTED + cuenta seleccionada + sin re-auth), NO una env var estática ni el
 * interruptor de AUTONOMÍA. `autonomousReal=false` NO puede bloquear una ejecución SUPERVISADA: el flag
 * supervisedReal se evalúa por separado en el gate del envelope. Fail-closed: sin conexión ⇒ no listo.
 */
import type { ProviderState } from './authorized-execution-envelope';
import { conexionOperativa, type ConexionGoogleAds } from '../acquisition/google-ads-connection';

/** ¿La conexión Google Ads está lista para EJECUTAR (real supervisada)? CONNECTED + customerId + sin re-auth. */
export function googleAdsListoParaEjecutar(conexion: ConexionGoogleAds | null): boolean {
  return conexion !== null && conexionOperativa(conexion.estado) && conexion.customerId != null && conexion.needsReauth !== true;
}

/**
 * ProviderState del gate EXTERNO derivado de la conexión REAL. `providerConnected`/`executionEligibleChannels`
 * salen del estado de la conexión, no de `GOOGLE_ADS_EXECUTION_GATE` (env estático) ni de `autonomousReal`.
 * tracking/landing se asumen válidos aquí (sus propios gates viven en la readiness del plan).
 */
export function providerStateDeConexion(conexion: ConexionGoogleAds | null, now: string): ProviderState {
  const ready = googleAdsListoParaEjecutar(conexion);
  return { executionEligibleChannels: ready ? ['google'] : [], providerConnected: ready, trackingValid: true, landingAvailable: true, now, contacts: 0 };
}
