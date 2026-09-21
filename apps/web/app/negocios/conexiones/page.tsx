'use client';

/**
 * CONEXIONES Y CAPACIDADES del negocio activo.
 *
 * Es la pantalla que cierra el alta: después de crear la empresa, aquí se conectan sus fuentes y se habilita
 * lo que SOEC puede hacer con ellas. Nada de esto exige tocar código ni desplegar.
 *
 * Reglas visibles en la propia interfaz:
 *  · el token se escribe UNA vez y no vuelve a mostrarse (el backend sólo dice si está configurado);
 *  · conectar una fuente NO enciende ninguna capacidad: son dos decisiones distintas;
 *  · una capacidad encendida sin su conexión lo dice («falta conectar»), en lugar de fingir que funciona.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ETIQUETA_CAPACIDAD,
  ETIQUETA_ESTADO_CONEXION,
  ETIQUETA_PROVEEDOR,
  deshabilitarConexion,
  fijarCapacidad,
  guardarGrowth,
  leerConexiones,
  probarConexion,
  type CapacidadNegocio,
  type EstadoConexiones,
} from '../../../lib/conexiones-client';

const CAPACIDADES_VISIBLES: CapacidadNegocio[] = [
  'INGESTA_GROWTH', 'MEDICION_REAL', 'DIRECTOR_REAL', 'CICLO_DIRECTOR', 'AUTONOMIA_ADS', 'MONITOR_SEGURIDAD',
];

export default function ConexionesPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoConexiones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Formulario del puente de medición.
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      const e = await leerConexiones(o);
      setEstado(e);
      const growth = e.conexiones.find((c) => c.provider === 'GROWTH_M2M');
      const base = (growth?.configuracion as { baseUrl?: string } | undefined)?.baseUrl;
      if (base && endpoint === '') setEndpoint(base);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'no se pudieron leer las conexiones');
    }
  }, [endpoint]);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  async function conCarga(fn: () => Promise<void>): Promise<void> {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'la operación no se completó');
    } finally {
      setOcupado(false);
    }
  }

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Conexiones</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const growth = estado?.conexiones.find((c) => c.provider === 'GROWTH_M2M') ?? null;

  return (
    <main className="wrap" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8 }}><Link href="/negocios">← Volver al panel</Link></p>
      <h1 style={{ marginBottom: 4 }}>Conexiones y permisos</h1>
      <p style={{ color: 'var(--muted, #666)', marginBottom: 24 }}>
        Conecta de dónde salen tus datos y decide qué puede hacer SOEC con ellos. Nada se enciende solo.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}
      {aviso !== null && <p style={{ color: '#0a7', marginBottom: 16 }}>{aviso}</p>}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Medición de tu sitio web</h2>
        <p style={{ color: 'var(--muted, #666)', marginBottom: 12 }}>
          SOEC lee la actividad de tu sitio desde un punto de entrada que tu web publica, con una clave que
          sólo conoce tu empresa. La clave se guarda cifrada: se escribe una vez y no vuelve a mostrarse.
        </p>

        {growth !== null && (
          <p style={{ marginBottom: 12 }}>
            Estado: <strong>{ETIQUETA_ESTADO_CONEXION[growth.estado].texto}</strong>
            {growth.credencial.configurada ? ' · clave guardada' : ' · sin clave'}
            {growth.validadaEn !== null ? ` · última prueba correcta: ${new Date(growth.validadaEn).toLocaleString()}` : ''}
            {growth.ultimoError !== null ? ` · último error: ${growth.ultimoError}` : ''}
          </p>
        )}

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Dirección del sitio (https) *</span>
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://tuempresa.cl" style={{ width: '100%', padding: 8 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
            Clave de acceso {growth?.credencial.configurada ? '(déjala vacía para conservar la actual)' : ''}
          </span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: 8 }} />
        </label>

        {estado !== null && !estado.depositoDisponible && (
          <p style={{ color: '#b00020', marginBottom: 12 }}>
            Este entorno no puede guardar claves todavía. Puedes dejar registrada la dirección; la clave se
            guardará cuando el almacén seguro esté disponible.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn primary"
            disabled={ocupado || endpoint.trim() === ''}
            onClick={() => void conCarga(async () => {
              const e = await guardarGrowth(org, { baseUrl: endpoint.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
              setEstado(e);
              setToken('');
              setAviso('Conexión guardada.');
            })}
            style={{ padding: '10px 18px', fontWeight: 600 }}
          >
            Guardar conexión
          </button>

          {growth !== null && growth.credencial.configurada && (
            <button
              type="button"
              className="btn"
              disabled={ocupado}
              onClick={() => void conCarga(async () => {
                const r = await probarConexion(org, 'GROWTH_M2M');
                setAviso(r.ok ? 'La conexión funciona.' : `No funcionó: ${r.detalle}`);
                await cargar(org);
              })}
              style={{ padding: '10px 18px' }}
            >
              Probar conexión
            </button>
          )}

          {growth !== null && growth.estado !== 'DISABLED' && (
            <button
              type="button"
              className="btn"
              disabled={ocupado}
              onClick={() => void conCarga(async () => {
                const e = await deshabilitarConexion(org, 'GROWTH_M2M');
                setEstado(e);
                setAviso('Conexión apagada y clave olvidada.');
              })}
              style={{ padding: '10px 18px' }}
            >
              Apagar y olvidar la clave
            </button>
          )}
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Publicidad</h2>
        {estado?.oauthGoogleAds !== null && estado?.oauthGoogleAds !== undefined ? (
          <p>
            Google Ads: <strong>{estado.oauthGoogleAds.estado}</strong>
            {estado.oauthGoogleAds.customerId !== null ? ` · cuenta ${estado.oauthGoogleAds.customerId}` : ''}
          </p>
        ) : (
          <p style={{ color: 'var(--muted, #666)' }}>
            Google Ads no está conectado. La conexión se hace con tu cuenta de Google desde{' '}
            <Link href="/adquisicion">Adquisición</Link>; aquí sólo se ve su estado.
          </p>
        )}
        {estado?.oauthMeta !== null && estado?.oauthMeta !== undefined && (
          <p>Meta (Facebook e Instagram): <strong>{estado.oauthMeta.estado}</strong> · sólo lectura</p>
        )}
        {estado?.conexiones.filter((c) => c.provider !== 'GROWTH_M2M').map((c) => (
          <p key={c.provider}>
            {ETIQUETA_PROVEEDOR[c.provider] ?? c.provider}: <strong>{ETIQUETA_ESTADO_CONEXION[c.estado].texto}</strong>
            {c.cuenta.id !== null ? ` · cuenta ${c.cuenta.id}` : ''}
          </p>
        ))}
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Qué puede hacer SOEC</h2>
        <p style={{ color: 'var(--muted, #666)', marginBottom: 12 }}>
          Cada permiso se enciende por separado y puedes apagarlo cuando quieras. Ninguno autoriza gastar
          dinero: eso se decide aparte, y por ti.
        </p>
        {estado?.capacidades
          .filter((c) => CAPACIDADES_VISIBLES.includes(c.capacidad))
          .map((c) => {
            const et = ETIQUETA_CAPACIDAD[c.capacidad];
            return (
              <div key={c.capacidad} style={{ borderTop: '1px solid var(--borde, #eee)', padding: '12px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={c.habilitada}
                  disabled={ocupado}
                  aria-label={et.titulo}
                  onChange={(ev) => void conCarga(async () => {
                    const e = await fijarCapacidad(org, c.capacidad, ev.target.checked);
                    setEstado(e);
                  })}
                  style={{ marginTop: 4 }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{et.titulo}</div>
                  <div style={{ color: 'var(--muted, #666)' }}>{et.explica}</div>
                  {c.habilitada && !c.conexionLista && (
                    <div style={{ color: '#b26a00' }}>
                      Encendido, pero falta conectar {ETIQUETA_PROVEEDOR[c.requiereConexion ?? ''] ?? c.requiereConexion}.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </section>
    </main>
  );
}
