'use client';

/**
 * Botón "Actualizar" del panel: dispara el REFRESH MANUAL de Google Ads ya construido/certificado
 * (`POST /api/google-ads/refresh` → sincronizarConexion, token cifrado por-tenant), espera el resultado,
 * y reporta éxito/error. NUNCA un no-op silencioso, NUNCA `router.refresh()` solo (eso no sincroniza datos).
 * Se deshabilita únicamente mientras refresca (no durante la carga del panel), para no quedar bloqueado.
 * READ-ONLY: no muta campañas ni presupuesto.
 */
import { useCallback, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';

interface RespuestaRefresh {
  readonly httpStatus: number;
  readonly error?: string;
  readonly datos?: { estado?: string; dataThrough?: string | null; error?: string | null };
}

/** Mapea la respuesta del refresh a un mensaje humano + si fue éxito. Puro y testeable. */
export function mensajeRefreshAds(r: RespuestaRefresh): { readonly texto: string; readonly ok: boolean } {
  const estado = r.datos?.estado;
  if (r.httpStatus === 409 || r.error === 'NOT_CONNECTED') return { texto: 'Google Ads no está conectado para este negocio.', ok: false };
  if (estado === 'OK') return { texto: `Datos actualizados · datos hasta ${r.datos?.dataThrough ?? '—'}.`, ok: true };
  if (estado === 'NEEDS_REAUTH') return { texto: 'Google Ads necesita reconexión. Tus datos históricos están conservados.', ok: false };
  return { texto: `No pudimos actualizar los datos: ${r.datos?.error ?? r.error ?? 'error de Google Ads'}. Se muestra el último dato conocido.`, ok: false };
}

export function BotonActualizarAds({
  org,
  onRefreshed,
  onAviso,
}: {
  org: string | null | undefined;
  onRefreshed?: () => void | Promise<void>;
  onAviso: (texto: string, ok: boolean) => void;
}): React.ReactElement {
  const [refrescando, setRefrescando] = useState(false);

  const actualizar = useCallback(async () => {
    if (!org) { onAviso('No hay una empresa activa para actualizar.', false); return; }
    setRefrescando(true);
    try {
      const r = await fetch('/api/google-ads/refresh', { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}' });
      const j = (await r.json().catch(() => ({}))) as { error?: string; datos?: { estado?: string; dataThrough?: string | null; error?: string | null } };
      const m = mensajeRefreshAds({ httpStatus: r.status, error: j.error, datos: j.datos });
      onAviso(m.texto, m.ok);
    } catch {
      onAviso('No pudimos actualizar los datos: no se pudo contactar el servicio.', false);
    } finally {
      setRefrescando(false);
      if (onRefreshed) await onRefreshed();
    }
  }, [org, onRefreshed, onAviso]);

  return (
    <button className="btn" disabled={refrescando} onClick={() => void actualizar()}>
      {refrescando ? 'Actualizando…' : 'Actualizar'}
    </button>
  );
}
