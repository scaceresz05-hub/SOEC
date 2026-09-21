/**
 * Cliente de CONEXIONES Y CAPACIDADES (vía BFF autenticado /api/backend/conexiones|capacidades).
 *
 * La organización activa viaja en cabecera; la sesión en cookie httpOnly. Este cliente NUNCA recibe el valor
 * de una credencial: el backend sólo dice si está configurada y de qué clase es. El token de una conexión
 * viaja una sola vez, del formulario al backend, y no vuelve.
 */
import { cabecerasOrg } from './org-activa';

export type ProveedorConexion = 'GOOGLE_ADS' | 'META_ADS' | 'GROWTH_M2M' | 'GA4' | 'SEARCH_CONSOLE' | 'MERCHANT_CENTER' | 'WOOCOMMERCE' | 'CRM';
export type EstadoConexion = 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISABLED';
export type CapacidadNegocio =
  | 'MEDICION_REAL' | 'DIRECTOR_REAL' | 'AUTONOMIA_ADS' | 'PILOTO_DECISION'
  | 'INGESTA_GROWTH' | 'MONITOR_SEGURIDAD' | 'CICLO_DIRECTOR';

export interface VistaConexion {
  provider: ProveedorConexion;
  estado: EstadoConexion;
  cuenta: { id: string | null; nombre: string | null };
  configuracion: Record<string, unknown>;
  credencial: { configurada: boolean; clase: 'DEPOSITO_CIFRADO' | 'ENTORNO' | null };
  ultimoError: string | null;
  validadaEn: string | null;
  origen: string;
}

export interface VistaCapacidad {
  capacidad: CapacidadNegocio;
  habilitada: boolean;
  requiereConexion: ProveedorConexion | null;
  conexionLista: boolean;
  motivo: string | null;
}

export interface EstadoConexiones {
  organizationId: string;
  conexiones: VistaConexion[];
  capacidades: VistaCapacidad[];
  depositoDisponible: boolean;
  oauthGoogleAds: { estado: string; customerId: string | null; salud: string } | null;
}

/** Etiquetas en lenguaje de negocio: el dueño lee qué hace cada cosa, no el nombre interno. */
export const ETIQUETA_PROVEEDOR: Record<string, string> = {
  GROWTH_M2M: 'Medición del sitio web',
  GOOGLE_ADS: 'Google Ads',
  META_ADS: 'Meta (Facebook e Instagram)',
  GA4: 'Google Analytics 4',
  SEARCH_CONSOLE: 'Search Console',
  MERCHANT_CENTER: 'Merchant Center',
  WOOCOMMERCE: 'Tienda WooCommerce',
  CRM: 'CRM',
};

export const ETIQUETA_ESTADO_CONEXION: Record<EstadoConexion, { texto: string; cls: string }> = {
  CONNECTED: { texto: 'Conectada', cls: 'ok' },
  PENDING: { texto: 'En trámite', cls: 'warn' },
  NOT_CONNECTED: { texto: 'Sin conectar', cls: 'warn' },
  ERROR: { texto: 'Con error', cls: 'bad' },
  DISABLED: { texto: 'Apagada', cls: 'muted' },
};

export const ETIQUETA_CAPACIDAD: Record<CapacidadNegocio, { titulo: string; explica: string }> = {
  INGESTA_GROWTH: { titulo: 'Leer la actividad del sitio', explica: 'SOEC recoge cada cierto tiempo lo que ocurre en tu web (visitas a servicios y contactos).' },
  MEDICION_REAL: { titulo: 'Medición real', explica: 'Ver resultados medidos de verdad, no ejemplos.' },
  DIRECTOR_REAL: { titulo: 'Director', explica: 'Análisis y recomendaciones sobre lo que está pasando.' },
  CICLO_DIRECTOR: { titulo: 'Director automático', explica: 'El análisis se ejecuta solo, cada pocos minutos, sin abrir el panel.' },
  AUTONOMIA_ADS: { titulo: 'Autonomía en publicidad', explica: 'Preparar y evaluar cambios de publicidad. Ejecutar sigue exigiendo tu autorización.' },
  MONITOR_SEGURIDAD: { titulo: 'Vigilancia de seguridad', explica: 'Vigila el gasto de la campaña y avisa. Pausar requiere, además, permiso de gobierno.' },
  PILOTO_DECISION: { titulo: 'Decisión del piloto', explica: 'Experiencia histórica del primer piloto.' },
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerConexiones(org: string): Promise<EstadoConexiones> {
  return j<EstadoConexiones>(await fetch('/api/backend/conexiones', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export interface EntradaGrowth {
  baseUrl: string;
  provider?: string;
  rutaIngesta?: string;
  hostsAutorizados?: string[];
  /** Se envía una sola vez y no vuelve nunca. */
  token?: string;
}

export async function guardarGrowth(org: string, entrada: EntradaGrowth): Promise<EstadoConexiones> {
  return j<EstadoConexiones>(
    await fetch('/api/backend/conexiones/growth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: JSON.stringify(entrada),
    }),
  );
}

export async function probarConexion(org: string, provider: ProveedorConexion): Promise<{ ok: boolean; detalle: string }> {
  return j<{ ok: boolean; detalle: string }>(
    await fetch(`/api/backend/conexiones/${provider.toLowerCase().replace(/_/g, '-')}/probar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: '{}',
    }),
  );
}

export async function deshabilitarConexion(org: string, provider: ProveedorConexion): Promise<EstadoConexiones> {
  return j<EstadoConexiones>(
    await fetch(`/api/backend/conexiones/${provider.toLowerCase().replace(/_/g, '-')}/deshabilitar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: '{}',
    }),
  );
}

export async function fijarCapacidad(org: string, capacidad: CapacidadNegocio, habilitada: boolean): Promise<EstadoConexiones> {
  return j<EstadoConexiones>(
    await fetch('/api/backend/capacidades', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: JSON.stringify({ capacidad, habilitada }),
    }),
  );
}
