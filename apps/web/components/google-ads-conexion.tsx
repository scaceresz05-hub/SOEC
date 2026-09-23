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

/**
 * ESTADO EN LENGUAJE DE NEGOCIO. Función pura: recibe el estado interno y cuántas cuentas se descubrieron,
 * y devuelve qué se le dice a la persona y cuál es su ÚNICA próxima acción.
 *
 * La regla que impone: ningún nombre interno sale a la pantalla. Quien lee esto no tiene por qué saber qué es
 * `ACCOUNT_SELECTION_PENDING`, un MCC o un refresh token; tiene que saber qué le falta y qué botón pulsar.
 */
export type AccionConexion = 'CONECTAR' | 'ELEGIR_CUENTA' | 'RECONECTAR' | 'NINGUNA' | 'ESPERAR_CUENTA';

export interface VistaEstadoGoogle {
  readonly titulo: string;
  readonly explicacion: string;
  readonly accion: AccionConexion;
  readonly etiquetaAccion: string | null;
  readonly tono: 'ok' | 'warn' | 'muted';
}

export function vistaDelEstadoGoogle(estado: string, cuentasDescubiertas: number | null): VistaEstadoGoogle {
  switch (estado) {
    case 'CONNECTED':
      return { titulo: 'Google Ads conectado', explicacion: 'SOEC puede leer lo que ocurre en tu cuenta.', accion: 'NINGUNA', etiquetaAccion: null, tono: 'ok' };
    case 'NEEDS_REAUTH':
      return {
        titulo: 'Google necesita que vuelvas a autorizar el acceso',
        explicacion: 'Tus datos históricos están conservados; sólo hay que renovar el permiso.',
        accion: 'RECONECTAR', etiquetaAccion: 'Volver a autorizar con Google', tono: 'warn',
      };
    case 'OAUTH_PENDING':
      return {
        titulo: 'Falta autorizar el acceso con Google',
        explicacion: 'Empezaste la conexión y quedó a medias. Puedes retomarla cuando quieras.',
        accion: 'CONECTAR', etiquetaAccion: 'Continuar con Google', tono: 'warn',
      };
    case 'ACCOUNT_SELECTION_PENDING':
      // CERO CUENTAS: es el caso de una empresa que autorizó con una cuenta de Google que todavía no tiene
      // ninguna cuenta de publicidad. No se muestra un selector vacío ni se le pide que aprenda Google Ads.
      if (cuentasDescubiertas === 0) {
        return {
          titulo: 'Google está autorizado, pero todavía no hay una cuenta de anuncios disponible',
          explicacion: 'Tu cuenta de Google está conectada y no encontramos ninguna cuenta de publicidad a la que SOEC pueda entrar. Hace falta configurar una con Google antes de seguir; te avisaremos en cuanto esté disponible.',
          accion: 'ESPERAR_CUENTA', etiquetaAccion: 'Volver a buscar', tono: 'warn',
        };
      }
      return {
        titulo: 'Elige qué cuenta administrará SOEC',
        explicacion: 'Tu cuenta de Google ya está autorizada. Falta decir en cuál de tus cuentas de publicidad debe trabajar.',
        accion: 'ELEGIR_CUENTA', etiquetaAccion: 'Elegir cuenta', tono: 'warn',
      };
    default:
      return {
        titulo: 'Google Ads no está conectado',
        explicacion: 'Conéctalo para que SOEC pueda ver tus campañas. Conectar no le permite cambiar nada ni gastar.',
        accion: 'CONECTAR', etiquetaAccion: 'Conectar Google Ads', tono: 'muted',
      };
  }
}

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
  /** Cuántas cuentas devolvió el último descubrimiento. `null` ⇒ todavía no se buscó. */
  const [descubiertas, setDescubiertas] = useState<number | null>(null);
  /** Cambiar de cuenta mueve dónde trabaja SOEC: se pide confirmación para que no ocurra de un clic. */
  const [confirmandoCambio, setConfirmandoCambio] = useState(false);

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
        const lista = j.datos.cuentas as Cuenta[];
        setDescubiertas(lista.length);
        // Sin cuentas no se abre un selector vacío: se explica el estado y se ofrece volver a buscar.
        setCuentas(lista.length > 0 ? lista : null);
        setElegida(lista[0]?.customerId ?? null);
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
        setAviso(
          typeof j?.mensaje === 'string' ? j.mensaje // el servidor ya lo explica en lenguaje de negocio
            : j?.error === 'ACCESO_DENEGADO' ? 'No tienes acceso a esa cuenta con esta autorización.'
              : 'No se pudo conectar la cuenta.',
        );
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
  const v = vistaDelEstadoGoogle(c.estado, descubiertas);
  const etq = ETIQUETA_DATOS[estado.datos.estado] ?? ETIQUETA_DATOS.NO_CONECTADO!;

  /** El botón que corresponde al estado. Uno solo: la persona no tiene que elegir entre caminos. */
  const accionPrincipal = (): React.ReactElement | null => {
    if (v.accion === 'CONECTAR' || v.accion === 'RECONECTAR') {
      return <button className="btn" disabled={ocupado !== null} onClick={() => void conectar()}>{ocupado === 'conectar' ? 'Abriendo…' : v.etiquetaAccion}</button>;
    }
    if (v.accion === 'ELEGIR_CUENTA' || v.accion === 'ESPERAR_CUENTA') {
      return <button className="btn" disabled={ocupado !== null} onClick={() => void listarCuentas()}>{ocupado === 'cuentas' ? 'Buscando…' : v.etiquetaAccion}</button>;
    }
    return null;
  };

  return (
    <div className="ga-card">
      <div className="ga-head">
        <b>Conexión a Google Ads</b>
        <span className={`ga-badge ${etq.cls}`}>{etq.texto}</span>
      </div>

      {aviso && <p className="ga-aviso">{aviso}</p>}

      {cuentas !== null ? (
        <div className="ga-body">
          <p>Elige la cuenta de publicidad en la que quieres que SOEC trabaje:</p>
          <ul className="ga-cuentas">
            {cuentas.map((cu) => (
              <li key={cu.customerId}>
                <label>
                  <input type="radio" name="ga-cuenta" checked={elegida === cu.customerId} onChange={() => setElegida(cu.customerId)} />
                  <span>
                    {cu.descriptiveName ?? 'Cuenta de publicidad'}
                    {cu.currencyCode ? ` · ${cu.currencyCode}` : ''}
                    {cu.manager ? ' · administradora (no aloja campañas)' : ''}
                    {cu.testAccount ? ' · de prueba' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="ga-acciones">
            <button className="btn" disabled={!elegida || ocupado !== null} onClick={() => void seleccionar()}>{ocupado === 'seleccionar' ? 'Conectando…' : 'Usar esta cuenta'}</button>
            <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => { setCuentas(null); setConfirmandoCambio(false); }}>Cancelar</button>
          </div>
        </div>
      ) : c.estado === 'CONNECTED' ? (
        <div className="ga-body">
          <p><b>{v.titulo}.</b> {v.explicacion}</p>
          <div className="ga-cuenta-actual">
            <div><span className="ga-muted">Cuenta</span><br />{c.descriptiveName ?? 'Cuenta de publicidad'}</div>
            <div><span className="ga-muted">Moneda</span><br />{c.currencyCode ?? '—'}</div>
            <div><span className="ga-muted">Zona horaria</span><br />{c.timeZone ?? '—'}</div>
            <div><span className="ga-muted">Última actualización</span><br />{fecha(estado.datos.ultimaActualizacion)}</div>
          </div>
          <p className="ga-muted">Conectar sirve para mirar. Cambiar campañas, gastar y encender se autorizan aparte, más abajo.</p>
          <div className="ga-acciones">
            <button className="btn" disabled={ocupado !== null} onClick={() => void actualizar()}>{ocupado === 'actualizar' ? 'Actualizando…' : 'Actualizar ahora'}</button>
            {confirmandoCambio ? (
              <>
                <span className="ga-muted">Cambiar de cuenta mueve dónde trabaja SOEC. ¿Seguimos?</span>
                <button className="btn" disabled={ocupado !== null} onClick={() => { setConfirmandoCambio(false); void listarCuentas(); }}>Sí, elegir otra cuenta</button>
                <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => setConfirmandoCambio(false)}>No, dejarla como está</button>
              </>
            ) : (
              <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => setConfirmandoCambio(true)}>Cambiar de cuenta</button>
            )}
            <button className="btn ga-sec" disabled={ocupado !== null} onClick={() => void desconectar()}>Desconectar</button>
          </div>
          <details className="ga-detalle">
            <summary>Detalles técnicos</summary>
            <p className="ga-muted">
              Identificador de la cuenta: {c.customerId ? fmtCuenta(c.customerId) : '—'} · datos hasta {estado.datos.dataThrough ?? '—'}
            </p>
          </details>
        </div>
      ) : (
        <div className="ga-body">
          <p><b>{v.titulo}.</b> {v.explicacion}</p>
          <div className="ga-acciones">{accionPrincipal()}</div>
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
        .ga-detalle { color: #64748b; font-size: 14px; }
      `}</style>
    </div>
  );
}
