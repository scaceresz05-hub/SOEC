/** Traducciones humanas de la superficie Meta: nada de enums/códigos/ISO crudos para el cliente. */
import type { Tono } from '../components/ui';

export function estadoHumano(estado: string): { texto: string; tono: Tono; detalle: string } {
  switch (estado) {
    case 'NOT_CONFIGURED':
      return { texto: 'Meta no disponible', tono: 'mut', detalle: 'La conexión con Meta aún no está habilitada en esta instalación.' };
    case 'NOT_CONNECTED':
      return { texto: 'Sin conectar', tono: 'mut', detalle: 'Conectá Meta para que SOEC lea tus datos de Instagram y anuncios.' };
    case 'BINDING_PENDING':
      return { texto: 'Elegí tus activos', tono: 'warn', detalle: 'Ya autorizaste Meta. Seleccioná qué cuentas querés que SOEC analice.' };
    case 'CONNECTED_READ_ONLY':
      return { texto: 'Conectado · Sólo lectura', tono: 'ok', detalle: 'SOEC está leyendo tus datos de Meta. No publica ni gasta nada.' };
    case 'DEGRADED':
      return { texto: 'Con problemas temporales', tono: 'warn', detalle: 'Algunos datos no pudieron actualizarse. SOEC reintenta automáticamente.' };
    case 'REAUTH_REQUIRED':
    case 'TOKEN_EXPIRED':
      return { texto: 'Necesita reconectarse', tono: 'risk', detalle: 'El acceso a Meta expiró. Reconectá para seguir viendo datos actualizados.' };
    case 'SCOPE_MISSING':
      return { texto: 'Faltan permisos', tono: 'warn', detalle: 'Reconectá otorgando los permisos de lectura que SOEC necesita.' };
    default:
      return { texto: 'Estado desconocido', tono: 'mut', detalle: '' };
  }
}

export function saludHumana(salud: string): { texto: string; tono: Tono } {
  switch (salud) {
    case 'HEALTHY':
      return { texto: 'Saludable', tono: 'ok' };
    case 'DEGRADED':
      return { texto: 'Degradada', tono: 'warn' };
    case 'TOKEN_EXPIRED':
    case 'REAUTH_REQUIRED':
      return { texto: 'Requiere reconexión', tono: 'risk' };
    case 'SCOPE_MISSING':
      return { texto: 'Faltan permisos', tono: 'warn' };
    default:
      return { texto: salud, tono: 'mut' };
  }
}

export function freshnessHumano(f: string): { texto: string; tono: Tono } {
  switch (f) {
    case 'FRESH':
      return { texto: 'Actualizado', tono: 'ok' };
    case 'STALE':
      return { texto: 'Por actualizarse', tono: 'warn' };
    case 'NEVER_SYNCED':
      return { texto: 'Sin datos aún', tono: 'mut' };
    case 'DEGRADED':
      return { texto: 'Con problemas', tono: 'warn' };
    case 'REAUTH_REQUIRED':
      return { texto: 'Requiere reconexión', tono: 'risk' };
    default:
      return { texto: f, tono: 'mut' };
  }
}

export function tipoActivoHumano(t: string): { nombre: string; ico: string } {
  switch (t) {
    case 'business':
      return { nombre: 'Empresa (Business)', ico: '🏢' };
    case 'page':
      return { nombre: 'Página de Facebook', ico: '📘' };
    case 'instagram':
      return { nombre: 'Instagram', ico: '📸' };
    case 'adAccount':
      return { nombre: 'Cuenta publicitaria', ico: '📊' };
    default:
      return { nombre: t, ico: '•' };
  }
}

export function capacidadHumana(c: string): string {
  const m: Record<string, string> = {
    BUSINESS_IDENTITY: 'Empresa',
    PAGE_IDENTITY: 'Página',
    INSTAGRAM_IDENTITY: 'Perfil de Instagram',
    INSTAGRAM_MEDIA: 'Publicaciones de Instagram',
    INSTAGRAM_INSIGHTS: 'Alcance de Instagram',
    ADS_ACCOUNT: 'Cuenta publicitaria',
    ADS_CAMPAIGNS: 'Campañas',
    ADS_INSIGHTS: 'Métricas de anuncios',
  };
  return m[c] ?? c;
}

/** Tiempo futuro relativo humano ("aprox. en 1 h", "en breve"); nunca ISO crudo. */
export function en(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'en breve';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'en menos de 1 min';
  if (min < 60) return `aprox. en ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `aprox. en ${h} h`;
  const d = Math.floor(h / 24);
  return `aprox. en ${d} día${d === 1 ? '' : 's'}`;
}

/** Tiempo relativo humano; nunca ISO crudo. */
export function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}
