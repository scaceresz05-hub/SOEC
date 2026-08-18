'use client';

/**
 * CENTRO DE CONEXIÓN META. Flujo comercial completo, sin jerga técnica:
 *  conectar → autorizar (OAuth) → elegir activos → confirmar → sincronizar → ver al Director.
 * Sólo lectura: nunca publica, gasta ni cambia nada en Meta. No muestra tokens/IDs como UX principal.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orgActiva } from '../../lib/org-activa';
import { yo } from '../../lib/auth-client';
import { activos, conexion, iniciarOAuth, sincronizar, vincular, estadoSync, configurarSync, readSmoke, redescubrir, type Candidato, type Conexion, type EstadoSync, type ResultadoReadSmoke } from '../../lib/meta-client';
import { estadoHumano, tipoActivoHumano, saludHumana, freshnessHumano, capacidadHumana, hace, en } from '../../lib/meta-ux';
import { Badge, Callout, EmptyState, Metric, PageHeader, TechDetails } from '../../components/ui';

export default function MetaPage(): React.ReactElement {
  const router = useRouter();
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [conn, setConn] = useState<Conexion | null>(null);
  const [cands, setCands] = useState<Candidato[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [accion, setAccion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (o: string) => {
    setCargando(true);
    setError(null);
    try {
      const c = await conexion(o);
      setConn(c);
      if (c.estado === 'BINDING_PENDING') {
        const a = await activos(o);
        setCands(a.candidatos);
        setSel(new Set(a.candidatos.filter((x) => x.bindingEligible !== false).map((x) => `${x.assetType}:${x.externalId}`)));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await yo();
      if (!s) { router.push('/login'); return; }
      const o = orgActiva();
      setOrg(o);
      if (o) await cargar(o);
      else setCargando(false);
    })();
  }, [router, cargar]);

  async function conectar(): Promise<void> {
    if (!org) return;
    setAccion('conectar');
    setError(null);
    try {
      const { authorizationUrl } = await iniciarOAuth(org);
      window.location.assign(authorizationUrl); // handoff seguro a Meta
    } catch (e) {
      setError((e as Error).message);
      setAccion(null);
    }
  }

  function toggle(key: string): void {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  async function confirmar(): Promise<void> {
    if (!org || !cands) return;
    setAccion('vincular');
    setError(null);
    try {
      for (const c of cands) {
        if (sel.has(`${c.assetType}:${c.externalId}`)) await vincular(org, c.externalId, c.assetType);
      }
      setAccion('sincronizar');
      await sincronizar(org);
      router.push('/director');
    } catch (e) {
      setError((e as Error).message);
      setAccion(null);
    }
  }

  if (cargando) return <div className="panel"><p className="muted">Cargando tu conexión con Meta…</p></div>;
  if (org === null) {
    return (
      <div className="panel">
        <EmptyState ico="🏢" titulo="Elegí una empresa primero" detalle="Necesitás seleccionar (o crear) tu empresa antes de conectar Meta.">
          <button className="btn primary" onClick={() => router.push('/select-organization')}>Ir a mis empresas</button>
        </EmptyState>
      </div>
    );
  }

  const st = estadoHumano(conn?.estado ?? 'NOT_CONNECTED');
  const o = org as string;

  return (
    <div className="panel">
      <PageHeader eyebrow="Conexión con Meta" title="Instagram y anuncios" right={<Badge tono={st.tono}>{st.texto}</Badge>} />
      <Callout tono={st.tono === 'ok' ? 'ok' : st.tono === 'risk' ? 'warn' : 'info'}>{st.detalle}</Callout>
      {error && <div className="aviso aviso--danger" style={{ margin: '12px 0' }}>{error}</div>}

      {(conn?.estado === 'NOT_CONNECTED' || conn?.estado === 'REAUTH_REQUIRED' || conn?.estado === 'TOKEN_EXPIRED' || conn?.estado === 'SCOPE_MISSING') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{conn.estado === 'NOT_CONNECTED' ? 'Conectá tu cuenta de Meta' : 'Reconectá tu cuenta de Meta'}</h2>
          <p className="muted">Te vamos a llevar a Meta para autorizar el acceso de <b>sólo lectura</b>. SOEC nunca publica ni gasta.</p>
          <button className="btn primary" onClick={conectar} disabled={accion === 'conectar'}>
            {accion === 'conectar' ? 'Abriendo Meta…' : conn.estado === 'NOT_CONNECTED' ? 'Conectar Meta' : 'Reconectar Meta'}
          </button>
        </div>
      )}

      {conn?.estado === 'BINDING_PENDING' && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Elegí qué querés que SOEC analice</h2>
          <p className="muted">Seleccioná los activos de tu negocio. Podés dejar afuera lo que no sea tuyo.</p>
          <div className="grid g-1" style={{ gap: 10, marginTop: 10 }}>
            {(cands ?? []).map((c) => {
              const key = `${c.assetType}:${c.externalId}`;
              const t = tipoActivoHumano(c.assetType);
              const elegible = c.bindingEligible !== false;
              return (
                <label key={key} className="srcrow" style={{ cursor: elegible ? 'pointer' : 'not-allowed', opacity: elegible ? 1 : 0.5 }}>
                  <input type="checkbox" checked={sel.has(key)} disabled={!elegible} onChange={() => toggle(key)} />
                  <span className="sico" aria-hidden="true">{t.ico}</span>
                  <div>
                    <div className="st">{c.displayName ?? t.nombre}</div>
                    <div className="ss">{t.nombre}{c.accessMode === 'USER_ACCESSIBLE' ? ' · accesible por tu usuario' : ''}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <button className="btn primary" style={{ marginTop: 14 }} onClick={confirmar} disabled={sel.size === 0 || accion === 'vincular' || accion === 'sincronizar'}>
            {accion === 'vincular' ? 'Conectando…' : accion === 'sincronizar' ? 'Sincronizando…' : `Confirmar conexión (${sel.size})`}
          </button>
        </div>
      )}

      {conn?.estado === 'CONNECTED_READ_ONLY' && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Meta conectado</h2>
          <p className="muted">SOEC está leyendo tus datos. Revisá el análisis de tu director.</p>
          {conn.bindings && conn.bindings.length > 0 && (
            <div className="grid g-1" style={{ gap: 8, marginTop: 8 }}>
              {conn.bindings.map((b) => {
                const t = tipoActivoHumano(b.assetType);
                return (
                  <div key={b.externalId} className="srcrow">
                    <span className="sico" aria-hidden="true">{t.ico}</span>
                    <div><div className="st">{b.displayName ?? t.nombre}</div><div className="ss">{t.nombre}</div></div>
                    <Badge tono="ok">Conectado</Badge>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => router.push('/director')}>Ver mi director</button>
            <button className="btn" onClick={() => org && sincronizar(org).then(() => cargar(org)).catch((e) => setError((e as Error).message))}>Actualizar ahora</button>
          </div>
        </div>
      )}

      {conn?.estado === 'CONNECTED_READ_ONLY' && <PanelDatos org={o} />}

      <TechDetails titulo="Detalles técnicos (avanzado)">
        <p className="small muted">Estado interno: {conn?.estado ?? '—'} · Organización: {o}</p>
      </TechDetails>
    </div>
  );
}

/** Nombre humano de cada check del read-smoke (evita enums crudos en la UI). */
const CHECK_HUMANO: Record<string, string> = {
  BUSINESS_READ: 'Empresa (Business)',
  PAGE_READ: 'Página de Facebook',
  INSTAGRAM_BASIC_READ: 'Perfil de Instagram',
  INSTAGRAM_MEDIA_READ: 'Publicaciones de Instagram',
  INSTAGRAM_INSIGHTS_READ: 'Alcance de Instagram',
  ADS_ACCOUNT_READ: 'Cuenta publicitaria',
  ADS_CAMPAIGNS_READ: 'Campañas',
  ADS_INSIGHTS_READ: 'Métricas de anuncios',
};

/* ── Estado de tus datos: última/próxima actualización, salud, auto-sync, verificación ────────── */
function PanelDatos({ org }: { org: string }): React.ReactElement {
  const [est, setEst] = useState<EstadoSync | null>(null);
  const [smoke, setSmoke] = useState<ResultadoReadSmoke | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setEst(await estadoSync(org)); } catch (e) { setErr((e as Error).message); }
  }, [org]);
  useEffect(() => { void cargar(); }, [cargar]);

  const salud = saludHumana(est?.health ?? '');
  const toggleSync = async () => {
    if (!est) return;
    setOcupado('sync'); setErr(null);
    try { await configurarSync(org, !est.syncEnabled); await cargar(); } catch (e) { setErr((e as Error).message); } finally { setOcupado(null); }
  };
  const verificar = async () => {
    setOcupado('smoke'); setErr(null);
    try { setSmoke(await readSmoke(org)); } catch (e) { setErr((e as Error).message); } finally { setOcupado(null); }
  };
  const redetectar = async () => {
    setOcupado('rediscover'); setErr(null);
    try { await redescubrir(org); await cargar(); } catch (e) { setErr((e as Error).message); } finally { setOcupado(null); }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Estado de tus datos</h2>
        <Badge tono={salud.tono}>{salud.texto}</Badge>
      </div>
      <div className="grid g-3" style={{ gap: 12, marginTop: 12 }}>
        <Metric label="Última actualización" value={hace(est?.lastSuccessfulSyncAt ?? null)} ico="🕓" />
        <Metric label="Próxima actualización" value={est?.syncEnabled ? en(est?.nextEligibleSyncAt ?? null) : 'pausada'} ico="⏭" />
        <Metric label="Actualización automática" value={est?.syncEnabled ? 'Activada' : 'Pausada'} sub={est ? `${est.consecutiveFailures} fallo(s) reciente(s)` : undefined} />
      </div>
      {est && est.consecutiveFailures > 0 && est.capabilitiesAffected.length > 0 && (
        <Callout tono="warn" ico="⚠">No se pudieron actualizar: {est.capabilitiesAffected.map(capacidadHumana).join(', ')}. SOEC reintenta automáticamente.</Callout>
      )}
      {err && <Callout tono="warn" ico="⚠">{err}</Callout>}
      <div className="row-wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={ocupado === 'sync' || !est} onClick={toggleSync}>{est?.syncEnabled ? 'Pausar actualización automática' : 'Activar actualización automática'}</button>
        <button className="btn" disabled={ocupado === 'smoke'} onClick={verificar}>{ocupado === 'smoke' ? 'Verificando…' : 'Verificar conexión'}</button>
        <button className="btn" disabled={ocupado === 'rediscover'} onClick={redetectar}>{ocupado === 'rediscover' ? 'Detectando…' : 'Volver a detectar activos'}</button>
      </div>
      {smoke && (
        <div style={{ marginTop: 12 }}>
          <Callout tono={smoke.pass ? 'ok' : 'warn'} ico={smoke.pass ? '✓' : '⚠'}>
            Verificación de acceso: {smoke.pass ? 'todo en orden' : 'algunas capacidades no respondieron'}{smoke.resumen ? ` (${smoke.resumen.replace(/_/g, ' ').toLowerCase()})` : ''}.
          </Callout>
          {smoke.checks && Object.keys(smoke.checks).length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {Object.entries(smoke.checks).map(([nombre, status]) => (
                <li key={nombre}>{CHECK_HUMANO[nombre] ?? nombre}: <b>{status === 'PASS' ? 'OK' : status === 'SKIP' ? 'no aplica' : 'sin acceso'}</b></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {est && est.freshness.length > 0 && (
        <TechDetails titulo="Detalle por tipo de dato">
          <ul>{est.freshness.map((f, i) => <li key={i}>{capacidadHumana(f.capability)}: {freshnessHumano(f.freshness).texto} {f.capturedAt ? `(${hace(f.capturedAt)})` : ''}</li>)}</ul>
        </TechDetails>
      )}
    </div>
  );
}
