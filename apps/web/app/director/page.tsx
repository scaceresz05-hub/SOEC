'use client';

/**
 * DASHBOARD DEL DIRECTOR. Valor en pocos minutos: qué pasa, qué cambió, qué requiere atención y qué hacer.
 * Consume /acquisition/meta/director (snapshots normalizados + inteligencia). Separa visualmente HECHO /
 * SEÑAL / HIPÓTESIS / RECOMENDACIÓN para no confundir observación con inferencia. Cero jerga técnica.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orgActiva } from '../../lib/org-activa';
import { yo } from '../../lib/auth-client';
import { director, sincronizar, estadoSync, type ItemConocimiento, type VistaDirector, type EstadoSync } from '../../lib/meta-client';
import { capacidadHumana, freshnessHumano, hace, en, saludHumana } from '../../lib/meta-ux';
import { Badge, Callout, DirectorCard, EmptyState, Metric, PageHeader, TechDetails, type Tono } from '../../components/ui';

const TIPO: Record<ItemConocimiento['type'], { etiqueta: string; tono: Tono }> = {
  FACT: { etiqueta: 'Dato', tono: 'info' },
  DERIVED_METRIC: { etiqueta: 'Métrica', tono: 'info' },
  SIGNAL: { etiqueta: 'Señal', tono: 'warn' },
  HYPOTHESIS: { etiqueta: 'Hipótesis', tono: 'mut' },
  RECOMMENDATION: { etiqueta: 'Recomendación', tono: 'ok' },
};
const prioTono = (p: ItemConocimiento['priority']): Tono => (p === 'CRITICAL' || p === 'HIGH' ? 'risk' : p === 'MEDIUM' ? 'warn' : 'mut');

function Grupo({ titulo, items }: { titulo: string; items: ItemConocimiento[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 8px' }}>{titulo}</h3>
      <div className="grid g-1" style={{ gap: 8 }}>
        {items.map((it) => (
          <div key={it.id} className="srcrow" style={{ alignItems: 'flex-start' }}>
            <Badge tono={TIPO[it.type].tono}>{TIPO[it.type].etiqueta}</Badge>
            <div style={{ minWidth: 0 }}>
              <div className="st">{it.title}</div>
              <div className="ss" style={{ whiteSpace: 'normal' }}>{it.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DirectorPage(): React.ReactElement {
  const router = useRouter();
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [v, setV] = useState<VistaDirector | null>(null);
  const [est, setEst] = useState<EstadoSync | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const cargar = useCallback(async (o: string) => {
    setCargando(true); setErr(null);
    try {
      setV(await director(o));
      setEst(await estadoSync(o).catch(() => null));
    } catch (e) { setErr((e as Error).message); } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await yo();
      if (!s) { router.push('/login'); return; }
      const o = orgActiva();
      setOrg(o);
      if (o) await cargar(o); else setCargando(false);
    })();
  }, [router, cargar]);

  if (cargando) return <div className="panel"><p className="muted">Preparando tu análisis…</p></div>;
  if (org === null) return <div className="panel"><EmptyState ico="🏢" titulo="Elegí una empresa" detalle="Seleccioná tu empresa para ver el análisis."><button className="btn primary" onClick={() => router.push('/select-organization')}>Ir a mis empresas</button></EmptyState></div>;

  // Sin conexión Meta ⇒ invitar a conectar.
  if (err && /NOT_CONNECTED|not connected/i.test(err)) {
    return <div className="panel"><EmptyState ico="🔗" titulo="Conectá Meta para ver tu análisis" detalle="SOEC necesita leer tu Instagram y anuncios para darte recomendaciones."><button className="btn primary" onClick={() => router.push('/meta')}>Conectar Meta</button></EmptyState></div>;
  }
  if (err || !v) return <div className="panel"><Callout tono="warn">No pudimos cargar tu análisis ahora. Probá de nuevo en un momento.</Callout></div>;

  const inteligencia = v.inteligencia;
  const cap = (c: string) => v.capacidades.find((x) => x.capability === c);
  const igMedia = cap('INSTAGRAM_MEDIA');
  const igReach = cap('INSTAGRAM_INSIGHTS');
  const igId = cap('INSTAGRAM_IDENTITY');
  const adCamp = cap('ADS_CAMPAIGNS');
  const adAcc = cap('ADS_ACCOUNT');
  const salud = saludHumana(v.health);
  const reachVal = igReach?.resumen?.metrics?.['reach'];

  return (
    <div className="panel dash">
      <PageHeader eyebrow="Tu director de marketing" title="Cómo va tu marketing" right={<Badge tono={salud.tono}>{salud.texto}</Badge>} />

      <DirectorCard estado={<Badge tono={salud.tono}>{salud.texto}</Badge>} dice={inteligencia.overview} extra={<span className="small muted">Fuente: <b>Meta</b> · Última actualización: {hace(v.lastSuccessfulSyncAt)}{est?.syncEnabled ? ` · próxima ${en(est.nextEligibleSyncAt)}` : est ? ' · actualización automática pausada' : ''} · anuncios: últimos 7 días</span>} />

      {(est?.freshness ?? []).some((f) => f.freshness === 'STALE') && (
        <Callout tono="warn" ico="⏳">
          Datos desactualizados · última actualización {hace(v.lastSuccessfulSyncAt)}.
          <button className="btn" style={{ marginLeft: 8 }} disabled={sincronizando} onClick={() => { if (org) { setSincronizando(true); sincronizar(org as string).then(() => cargar(org as string)).finally(() => setSincronizando(false)); } }}>{sincronizando ? 'Actualizando…' : 'Actualizar ahora'}</button>
        </Callout>
      )}

      {/* Requiere tu atención */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ margin: '0 0 8px' }}>Requiere tu atención</h3>
        {inteligencia.priorities.length === 0 ? (
          <p className="muted">No hay alertas urgentes hoy. 👌</p>
        ) : (
          <div className="grid g-1" style={{ gap: 8 }}>
            {inteligencia.priorities.map((p) => (
              <div key={p.id} className="srcrow" style={{ alignItems: 'flex-start' }}>
                <Badge tono={prioTono(p.priority)}>{p.priority === 'CRITICAL' || p.priority === 'HIGH' ? 'Importante' : p.priority === 'MEDIUM' ? 'A revisar' : 'Menor'}</Badge>
                <div style={{ minWidth: 0 }}><div className="st">{p.title}</div><div className="ss" style={{ whiteSpace: 'normal' }}>{p.summary}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumen Instagram / Ads */}
      <div className="grid g-2" style={{ marginTop: 12, gap: 12 }}>
        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>📸 Instagram {igId?.resumen?.identity?.['username'] ? <span className="small muted">@{igId.resumen.identity['username']}</span> : null}</h3>
          <div className="grid g-2" style={{ gap: 8 }}>
            <Metric label="Publicaciones" value={igMedia?.resumen?.count !== undefined ? String(igMedia.resumen.count) : '—'} sub={igMedia ? freshnessHumano(igMedia.freshness).texto : undefined} />
            <Metric label="Alcance (día)" value={typeof reachVal === 'number' ? String(reachVal) : 'Sin datos'} unknown={typeof reachVal !== 'number'} sub={igReach ? freshnessHumano(igReach.freshness).texto : undefined} />
          </div>
        </div>
        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>📊 Anuncios {adAcc?.resumen?.identity?.['currency'] ? <span className="small muted">{adAcc.resumen.identity['currency']}</span> : null}</h3>
          <div className="grid g-2" style={{ gap: 8 }}>
            <Metric label="Campañas visibles" value={adCamp?.resumen?.count !== undefined ? String(adCamp.resumen.count) : '—'} sub={adCamp ? freshnessHumano(adCamp.freshness).texto : undefined} />
            <Metric label="Inversión medida" value="Sin datos" unknown sub="No hay métricas de gasto todavía" />
          </div>
        </div>
      </div>

      {/* Conocimiento separado por tipo (epistemología clara) */}
      <Grupo titulo="Qué está pasando (hechos)" items={inteligencia.facts.filter((f) => f.priority !== 'INFO' || f.id !== 'info:no-roi').concat(inteligencia.facts.filter((f) => f.id === 'info:no-roi'))} />
      <Grupo titulo="Señales" items={inteligencia.signals} />
      <Grupo titulo="Hipótesis (posibles explicaciones, no confirmadas)" items={inteligencia.hypotheses} />
      <Grupo titulo="Recomendaciones" items={inteligencia.recommendations} />

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn" onClick={() => { if (org) { setSincronizando(true); sincronizar(org as string).then(() => cargar(org as string)).finally(() => setSincronizando(false)); } }} disabled={sincronizando}>
          {sincronizando ? 'Actualizando…' : 'Actualizar datos'}
        </button>
        <button className="btn" onClick={() => router.push('/meta')}>Gestionar conexión</button>
      </div>

      <TechDetails titulo="Estado de tus datos (por tipo)">
        <div className="grid g-1" style={{ gap: 4 }}>
          {v.capacidades.map((c) => {
            const f = freshnessHumano(c.freshness);
            return <div key={c.capability} className="small"><b>{capacidadHumana(c.capability)}</b>: {f.texto}{c.capturedAt ? ` · ${hace(c.capturedAt)}` : ''}</div>;
          })}
        </div>
      </TechDetails>
    </div>
  );
}
