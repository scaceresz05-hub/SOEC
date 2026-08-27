'use client';

/**
 * Conexión de Google Ads para una persona normal (sin OAuth internals). Flujo:
 *   No conectado → [Conectar Google Ads] → consentimiento de Google → elegir cuenta → Conectado.
 * Estados técnicos (refresh_token, invalid_grant, developer_token) NUNCA se muestran: se traducen a
 * lenguaje humano ("necesita reconexión", "datos históricos conservados"). Solo lectura.
 */

import { useCallback, useEffect, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';

interface ConexionDTO {
  estado: 'NOT_CONNECTED' | 'OAUTH_PENDING' | 'ACCOUNT_SELECTION_PENDING' | 'CONNECTED' | 'NEEDS_REAUTH' | 'DISCONNECTED';
  salud: string;
  customerId: string | null;
  descriptiveName: string | null;
  timeZone: string | null;
  currencyCode: string | null;
  needsReauth: boolean;
  connectedAt: string | null;
}
interface EstadoConexion {
  conexion: ConexionDTO;
  datos: { estado: string; capturedAt: string | null; dataThrough: string | null; ultimaActualizacion: string | null; impressions: number | null; clicks: number | null; cost: number | null };
  configurado: boolean;
}
interface Cuenta { customerId: string; descriptiveName: string | null; currencyCode: string | null; timeZone: string | null; manager: boolean; testAccount: boolean }

const ETIQUETA_DATOS: Record<string, { texto: string; cls: string }> = {
  ACTUALIZADO: { texto: 'Actualizado', cls: 'ok' },
  DESACTUALIZADO: { texto: 'Desactualizado', cls: 'warn' },
  SIN_DATOS: { texto: 'Sin datos todavía', cls: 'warn' },
  NECESITA_RECONEXION: { texto: 'Necesita reconexión', cls: 'err' },
  NO_CONECTADO: { texto: 'No conectado', cls: 'muted' },
};

function fecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtCuenta(id: string): string {
  return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

export function GoogleAdsConexion({ org }: { org: string }): React.ReactElement {
  const [estado, setEstado] = useState<EstadoConexion | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const headers = useCallback(() => ({ 'content-type': 'application/json', ...cabecerasOrg(org) }), [org]);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/google-ads/connection', { cache: 'no-store', headers: cabecerasOrg(org) });
      setEstado(r.ok ? ((await r.json()).datos as EstadoConexion) : null);
    } catch {
      setEstado(null);
    }
  }, [org]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const conectar = useCallback(async () => {
    setOcupado('conectar');
    setAviso(null);
    try {
      const r = await fetch('/api/google-ads/oauth/start', { method: 'POST', headers: headers(), body: '{}' });
      const j = await r.json();
      if (r.ok && j?.datos?.authorizationUrl) window.location.href = j.datos.authorizationUrl as string;
      else setAviso('Google Ads todavía no está disponible en este entorno.');
    } catch {
      setAviso('No se pudo iniciar la conexión.');
    } finally {
      setOcupado(null);
    }
  }, [headers]);

  const listarCuentas = useCallback(async () => {
    setOcupado('cuentas');
    setAviso(null);
    try {
      // Discovery READ ONLY ⇒ GET (no muta conexión ni campañas). Mismo patrón que /connection.
      const r = await fetch('/api/google-ads/accounts', { method: 'GET', cache: 'no-store', headers: cabecerasOrg(org) });
      const j = await r.json();
      if (r.ok && j?.datos?.cuentas) {
        setCuentas(j.datos.cuentas as Cuenta[]);
        setElegida((j.datos.cuentas[0] as Cuenta | undefined)?.customerId ?? null);
      } else if (j?.error === 'NEEDS_REAUTH') {
        setAviso('Google Ads necesita reconexión.');
        void cargar();
      } else setAviso('No pudimos leer tus cuentas de Google Ads.');
    } catch {
      setAviso('No se pudieron cargar las cuentas.');
    } finally {
      setOcupado(null);
    }
  }, [headers, cargar]);

  const seleccionar = useCallback(async () => {
    if (!elegida) return;
    setOcupado('seleccionar');
    setAviso(null);
    try {
      const r = await fetch('/api/google-ads/select-account', { method: 'POST', headers: headers(), body: JSON.stringify({ customerId: elegida }) });
      if (r.ok) {
        setCuentas(null);
        await cargar();
      } else {
        const j = await r.json();
        setAviso(j?.error === 'ACCESO_DENEGADO' ? 'No tenés acceso a esa cuenta con esta autorización.' : 'No se pudo conectar la cuenta.');
      }
    } finally {
      setOcupado(null);
    }
  }, [elegida, headers, cargar]);

  const actualizar = useCallback(async () => {
    setOcupado('actualizar');
    setAviso(null);
    try {
      const r = await fetch('/api/google-ads/refresh', { method: 'POST', headers: headers(), body: '{}' });
      const j = await r.json();
      if (!r.ok || j?.datos?.estado === 'NEEDS_REAUTH') setAviso('Google Ads necesita reconexión. Tus datos históricos están conservados.');
      await cargar();
    } finally {
      setOcupado(null);
    }
  }, [headers, cargar]);

  const desconectar = useCallback(async () => {
    setOcupado('desconectar');
    try {
      await fetch('/api/google-ads/disconnect', { method: 'POST', headers: headers(), body: '{}' });
      setCuentas(null);
      await cargar();
    } finally {
      setOcupado(null);
    }
  }, [headers, cargar]);

  // Al volver del consentimiento de Google (?ga=…) abrimos la selección de cuenta o mostramos el aviso.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ga = new URLSearchParams(window.location.search).get('ga');
    if (ga === 'seleccionar_cuenta') void listarCuentas();
    else if (ga === 'oauth_fallido') setAviso('No pudimos completar la conexión con Google. Intentá de nuevo.');
    else if (ga === 'cancelado') setAviso('Cancelaste la conexión con Google.');
  }, [listarCuentas]);

  if (estado === null) return <div className="ga-card">Google Ads · cargando…</div>;

  const c = estado.conexion;
  const etq = ETIQUETA_DATOS[estado.datos.estado] ?? ETIQUETA_DATOS.NO_CONECTADO!;

  return (
    <div className="ga-card">
      <div className="ga-head">
        <b>Google Ads</b>
        <span className={`ga-badge ${etq.cls}`}>{etq.texto}</span>
      </div>

      {aviso && <p className="ga-aviso">{aviso}</p>}

      {/* Selección de cuenta (tras volver del consentimiento o al "Cambiar cuenta") */}
      {cuentas !== null ? (
        <div className="ga-body">
          <p>Elegí la cuenta de Google Ads que querés conectar:</p>
          {cuentas.length === 0 && <p className="ga-muted">No encontramos cuentas accesibles con esta autorización.</p>}
          <ul className="ga-cuentas">
            {cuentas.map((cu) => (
              <li key={cu.customerId}>
                <label>
                  <input type="radio" name="ga-cuenta" checked={elegida === cu.customerId} onChange={() => setElegida(cu.customerId)} />
                  <span>{cu.descriptiveName ?? 'Cuenta'} · {fmtCuenta(cu.customerId)}{cu.manager ? ' · administradora' : ''}{cu.testAccount ? ' · prueba' : ''}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="ga-acciones">
            <button className="btn" disabled={!elegida || ocupado !== null} onClick={() => void seleccionar()}>{ocupado === 'seleccionar' ? 'Conectando…' : 'Conectar'}</button>
            <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => setCuentas(null)}>Cancelar</button>
          </div>
        </div>
      ) : c.estado === 'CONNECTED' ? (
        <div className="ga-body">
          <div className="ga-cuenta-actual">
            <div><span className="ga-muted">Cuenta</span><br />{c.descriptiveName ?? 'Cuenta'} · {c.customerId ? fmtCuenta(c.customerId) : '—'}</div>
            <div><span className="ga-muted">Datos hasta</span><br />{estado.datos.dataThrough ?? '—'}</div>
            <div><span className="ga-muted">Última actualización</span><br />{fecha(estado.datos.ultimaActualizacion)}</div>
          </div>
          <div className="ga-acciones">
            <button className="btn" disabled={ocupado !== null} onClick={() => void actualizar()}>{ocupado === 'actualizar' ? 'Actualizando…' : 'Actualizar ahora'}</button>
            <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => void listarCuentas()}>Cambiar cuenta</button>
            <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => void conectar()}>Reconectar</button>
            <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => void desconectar()}>Desconectar</button>
          </div>
        </div>
      ) : c.estado === 'NEEDS_REAUTH' ? (
        <div className="ga-body">
          <p>Google Ads necesita reconexión. <b>Tus datos históricos están conservados.</b></p>
          <div className="ga-acciones">
            <button className="btn" disabled={ocupado !== null} onClick={() => void conectar()}>{ocupado === 'conectar' ? 'Abriendo…' : 'Reconectar Google Ads'}</button>
          </div>
        </div>
      ) : c.estado === 'ACCOUNT_SELECTION_PENDING' ? (
        <div className="ga-body">
          <p>Autorización lista. Elegí la cuenta que querés conectar.</p>
          <div className="ga-acciones">
            <button className="btn" disabled={ocupado !== null} onClick={() => void listarCuentas()}>{ocupado === 'cuentas' ? 'Cargando…' : 'Elegir cuenta'}</button>
          </div>
        </div>
      ) : (
        <div className="ga-body">
          <p className="ga-muted">Conectá tu cuenta de Google Ads para ver tus campañas dentro de SOEC (solo lectura).</p>
          <div className="ga-acciones">
            <button className="btn" disabled={ocupado !== null} onClick={() => void conectar()}>{ocupado === 'conectar' ? 'Abriendo…' : 'Conectar Google Ads'}</button>
          </div>
        </div>
      )}

      <style jsx>{`
        .ga-card { border: 1px solid var(--borde, #e5e7eb); border-radius: 12px; padding: 16px; margin: 12px 0; background: var(--panel, #fff); }
        .ga-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .ga-badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; }
        .ga-badge.ok { background: #dcfce7; color: #166534; }
        .ga-badge.warn { background: #fef9c3; color: #854d0e; }
        .ga-badge.err { background: #fee2e2; color: #991b1b; }
        .ga-badge.muted { background: #f1f5f9; color: #475569; }
        .ga-body { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
        .ga-muted { color: #64748b; }
        .ga-aviso { margin-top: 8px; color: #854d0e; background: #fef9c3; padding: 8px 10px; border-radius: 8px; font-size: 14px; }
        .ga-cuentas { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .ga-cuentas label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .ga-cuenta-actual { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
        .ga-acciones { display: flex; flex-wrap: wrap; gap: 8px; }
        .ga-sec { background: transparent; border: 1px solid var(--borde, #cbd5e1); color: inherit; }
      `}</style>
    </div>
  );
}
