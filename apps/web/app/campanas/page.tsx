'use client';

/**
 * CAMPAÑAS — superficie comercial V2 (dry-run/shadow). El humano AUTORIZA un tope de presupuesto (mandato);
 * SOEC PREPARA la campaña y muestra qué HARÍA, sin publicar ni gastar nada real. La soberanía financiera es
 * absoluta: SOEC nunca sube el tope ni gasta fuera del mandato. Todo lo que se ve aquí es simulación.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orgActiva } from '../../lib/org-activa';
import { yo } from '../../lib/auth-client';
import {
  mandatoActual, crearMandato, gobernarMandato, simularCampana, correrShadow,
  money, type Mandato, type CampaignPlan, type EjecucionCampana, type ShadowRun, type EntradaCampana,
} from '../../lib/campana-client';
import { Badge, Callout, EmptyState, Metric, PageHeader, TechDetails, type Tono } from '../../components/ui';

const estadoTono = (s: string): Tono => (s === 'ACTIVE' ? 'ok' : s === 'PAUSED' || s === 'AUTHORIZED' ? 'warn' : s === 'REVOKED' || s === 'EXPIRED' || s === 'EXHAUSTED' ? 'risk' : 'mut');

export default function CampanasPage(): React.ReactElement {
  const router = useRouter();
  const [org, setOrg] = useState<string | null>(null);
  const [mandato, setMandato] = useState<Mandato | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async (o: string) => {
    setCargando(true); setError(null);
    try { setMandato(await mandatoActual(o)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar'); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => {
    void (async () => {
      const sesion = await yo().catch(() => null);
      if (!sesion) { router.replace('/login?next=/campanas'); return; }
      const o = orgActiva();
      setOrg(o);
      if (o) await recargar(o); else setCargando(false);
    })();
  }, [router, recargar]);

  if (!org) return (
    <div className="wrap">
      <PageHeader eyebrow="Campañas" title="Elige un negocio" />
      <EmptyState titulo="Sin negocio seleccionado" detalle="Elige un negocio en la barra superior para preparar campañas." />
    </div>
  );

  return (
    <div className="wrap">
      <PageHeader eyebrow="Campañas · modo seguro" title="Prepara tu campaña" right={mandato ? <Badge tono={estadoTono(mandato.status)}>{mandato.status}</Badge> : undefined} />
      <Callout tono="info" ico="🛡️">
        Todo aquí es <b>simulación</b>. SOEC no publica ni gasta dinero real. Tú fijas un <b>tope de presupuesto</b> y SOEC trabaja siempre dentro de él: nunca lo sube por su cuenta.
      </Callout>
      {error && <Callout tono="warn" ico="⚠">{error}</Callout>}
      {cargando ? <p className="mut">Cargando…</p> : mandato ? <ConMandato org={org} mandato={mandato} onCambio={() => recargar(org)} /> : <SinMandato org={org} onCreado={() => recargar(org)} />}
    </div>
  );
}

/* ── Autorización del mandato (soberanía financiera humana) ─────────────────── */
function SinMandato({ org, onCreado }: { org: string; onCreado: () => void }): React.ReactElement {
  const hoy = new Date().toISOString().slice(0, 10);
  const en30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const [objective, setObjective] = useState('Más consultas de pacientes');
  const [presupuesto, setPresupuesto] = useState(100000);
  const [inicio, setInicio] = useState(hoy);
  const [fin, setFin] = useState(en30);
  const [adAccount, setAdAccount] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const enviar = async () => {
    setEnviando(true); setErr(null);
    try {
      await crearMandato(org, {
        objective, currency: 'CLP', authorizedBudgetMinor: Math.max(0, Math.trunc(presupuesto)),
        periodStart: new Date(inicio).toISOString(), periodEnd: new Date(fin).toISOString(),
        allowedMetaAssets: adAccount.trim() ? [adAccount.trim()] : [],
        allowedActionTypes: ['UPDATE_CREATIVE_DRAFT', 'CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_AD', 'PAUSE_AD'],
      });
      onCreado();
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo autorizar'); }
    finally { setEnviando(false); }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>1 · Autoriza un presupuesto</h3>
      <p className="mut">Este es tu <b>tope</b>. SOEC jamás lo supera. Para cambiarlo, decides tú (reautorización).</p>
      <div className="grid g-2" style={{ gap: 12 }}>
        <label>Objetivo del negocio<input value={objective} onChange={(e) => setObjective(e.target.value)} /></label>
        <label>Presupuesto tope (CLP)<input type="number" min={0} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value))} /></label>
        <label>Desde<input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label>Hasta<input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></label>
        <label>Cuenta publicitaria (activo Meta autorizado)<input value={adAccount} placeholder="act_XXXXXXXXX" onChange={(e) => setAdAccount(e.target.value)} /></label>
      </div>
      {err && <Callout tono="warn" ico="⚠">{err}</Callout>}
      <div style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={enviar} disabled={enviando}>{enviando ? 'Autorizando…' : 'Autorizar presupuesto'}</button>
      </div>
    </div>
  );
}

/* ── Con mandato: resumen + preparación de campaña + autonomía en sombra ────── */
function ConMandato({ org, mandato, onCambio }: { org: string; mandato: Mandato; onCambio: () => void }): React.ReactElement {
  return (
    <>
      <div className="grid g-3" style={{ gap: 12, marginTop: 12 }}>
        <Metric label="Presupuesto tope" value={money(mandato.authorizedBudgetMinor, mandato.currency)} ico="🎯" accent />
        <Metric label="Comprometido (real)" value={money(mandato.spentMinor, mandato.currency)} sub="0 mientras esté en modo seguro" />
        <Metric label="Disponible" value={money(mandato.remainingMinor, mandato.currency)} />
      </div>
      <Gobierno org={org} mandato={mandato} onCambio={onCambio} />
      <Preparar org={org} mandato={mandato} />
      <Autonomia org={org} />
    </>
  );
}

function Gobierno({ org, mandato, onCambio }: { org: string; mandato: Mandato; onCambio: () => void }): React.ReactElement {
  const [ocupado, setOcupado] = useState(false);
  const gobernar = async (b: unknown) => { setOcupado(true); try { await gobernarMandato(org, mandato.id, b); onCambio(); } finally { setOcupado(false); } };
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Control</h3>
      <div className="row-wrap" style={{ gap: 8 }}>
        {mandato.status === 'PAUSED'
          ? <button className="btn" disabled={ocupado} onClick={() => gobernar({ accion: 'reanudar' })}>Reanudar</button>
          : <button className="btn" disabled={ocupado} onClick={() => gobernar({ accion: 'pausar' })}>Pausar</button>}
        <button className="btn" disabled={ocupado} onClick={() => gobernar({ accion: 'killswitch', killSwitch: !mandato.killSwitch })}>{mandato.killSwitch ? 'Quitar freno de emergencia' : 'Freno de emergencia'}</button>
      </div>
      <p className="mut" style={{ marginBottom: 0 }}>Detener siempre es inmediato y es tu decisión. SOEC no puede reanudar ni ampliar por su cuenta.</p>
    </div>
  );
}

function Preparar({ org, mandato }: { org: string; mandato: Mandato }): React.ReactElement {
  const [nombre, setNombre] = useState('');
  const [rubro, setRubro] = useState('odontología');
  const [servicios, setServicios] = useState('limpieza dental, ortodoncia');
  const [comuna, setComuna] = useState('');
  const [objetivo, setObjetivo] = useState('RECONOCIMIENTO');
  const [placement, setPlacement] = useState('instagram');
  const [presupuesto, setPresupuesto] = useState(Math.min(50000, mandato.remainingMinor));
  const [res, setRes] = useState<{ plan: CampaignPlan; ejecucion: EjecucionCampana } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preparar = async () => {
    setOcupado(true); setErr(null); setRes(null);
    const entrada: EntradaCampana = {
      perfil: { nombre: nombre.trim() || 'Tu negocio', rubro: rubro.trim() || 'servicios', serviciosDeclarados: servicios.split(',').map((s) => s.trim()).filter(Boolean), ...(comuna.trim() ? { comuna: comuna.trim() } : {}) },
      objetivo, placement, presupuestoDeseadoMinor: Math.max(0, Math.trunc(presupuesto)),
    };
    try { setRes(await simularCampana(org, entrada)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo preparar'); }
    finally { setOcupado(false); }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>2 · Prepara la campaña (simulación)</h3>
      <div className="grid g-2" style={{ gap: 12 }}>
        <label>Nombre del negocio<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Clínica Norte" /></label>
        <label>Rubro<input value={rubro} onChange={(e) => setRubro(e.target.value)} /></label>
        <label>Servicios (separados por coma)<input value={servicios} onChange={(e) => setServicios(e.target.value)} /></label>
        <label>Comuna (opcional)<input value={comuna} onChange={(e) => setComuna(e.target.value)} /></label>
        <label>Objetivo<select value={objetivo} onChange={(e) => setObjetivo(e.target.value)}><option value="RECONOCIMIENTO">Que me conozcan</option><option value="CONSIDERACION">Que me consideren</option><option value="MENSAJES">Que me escriban</option><option value="TRAFICO">Visitas al sitio</option></select></label>
        <label>Dónde<select value={placement} onChange={(e) => setPlacement(e.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select></label>
        <label>Presupuesto de esta campaña (CLP)<input type="number" min={0} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value))} /></label>
      </div>
      {err && <Callout tono="warn" ico="⚠">{err}</Callout>}
      <div style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={preparar} disabled={ocupado}>{ocupado ? 'Preparando…' : 'Ver qué haría SOEC'}</button>
      </div>
      {res && <ResultadoPlan plan={res.plan} ejecucion={res.ejecucion} moneda={mandato.currency} />}
    </div>
  );
}

function ResultadoPlan({ plan, ejecucion, moneda }: { plan: CampaignPlan; ejecucion: EjecucionCampana; moneda: string }): React.ReactElement {
  return (
    <div style={{ marginTop: 16 }}>
      <Callout tono={ejecucion.ok ? 'ok' : 'warn'} ico={ejecucion.ok ? '✓' : '⚠'}>{ejecucion.resumen}</Callout>
      <div className="grid g-3" style={{ gap: 12, marginTop: 8 }}>
        <Metric label="Gastaría (simulado)" value={money(ejecucion.gastoProyectadoMinor, moneda)} sub="si tú lo activaras" />
        <Metric label="Gasto real ahora" value={money(ejecucion.gastoComprometidoMinor, moneda)} sub="modo seguro" />
        <Metric label="Publicaciones reales en Meta" value={String(ejecucion.metaWriteCallsReales)} sub="0 en modo seguro" />
      </div>
      <h4>Anuncios propuestos</h4>
      <div className="grid g-2" style={{ gap: 12 }}>
        {plan.anuncios.map((a) => (
          <div className="card" key={a.variante} style={{ margin: 0 }}>
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <b>Variante {a.variante}</b>
              <Badge tono={a.contenido.policy.permitido ? 'ok' : 'risk'}>{a.contenido.policy.permitido ? 'Contenido OK' : 'Revisar'}</Badge>
            </div>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>{a.contenido.headline}</p>
            <p style={{ margin: '4px 0' }}>{a.contenido.primaryText}</p>
            <p className="mut" style={{ margin: '4px 0' }}>{a.contenido.hashtags.join(' ')}</p>
            <p className="mut" style={{ margin: 0 }}>CTA: {a.contenido.cta}</p>
            {!a.contenido.policy.permitido && <ul>{a.contenido.policy.violaciones.map((v, i) => <li key={i} className="mut">{v.detalle}</li>)}</ul>}
          </div>
        ))}
      </div>
      {plan.advertencias.length > 0 && <Callout tono="warn" ico="ℹ">{plan.advertencias.join(' · ')}</Callout>}
      <TechDetails titulo="Pasos de la simulación (auditoría)">
        <ul>
          {ejecucion.pasos.map((p) => (
            <li key={p.orden}>{p.descripcion} — <b>{p.estado}</b>{p.bloqueos.length ? ` (${p.bloqueos.join(', ')})` : ''}{p.externalRef ? ` · ${p.externalRef}` : ''}</li>
          ))}
        </ul>
      </TechDetails>
    </div>
  );
}

/* ── Autonomía en sombra: qué decidiría SOEC observando resultados ──────────── */
function Autonomia({ org }: { org: string }): React.ReactElement {
  const [run, setRun] = useState<ShadowRun | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const correr = async () => {
    setOcupado(true); setErr(null);
    // Observaciones de ejemplo para ilustrar el criterio; en real vendrían de Meta (lectura).
    const observaciones = [
      { adRef: 'ejemplo-bajo', impresiones: 8000, clics: 8, gastoMinor: 40000, resultados: 0, ventanaHoras: 24 },
      { adRef: 'ejemplo-ok', impresiones: 8000, clics: 120, gastoMinor: 40000, resultados: 10, ventanaHoras: 24 },
    ];
    try { setRun(await correrShadow(org, observaciones)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo simular'); }
    finally { setOcupado(false); }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>3 · Qué haría SOEC solo (en sombra)</h3>
      <p className="mut">SOEC observa resultados y propone ajustes DENTRO de tu tope. Cualquier cosa que implique más dinero queda como <b>recomendación para tu aprobación</b>.</p>
      <button className="btn" onClick={correr} disabled={ocupado}>{ocupado ? 'Simulando…' : 'Simular un ciclo autónomo'}</button>
      {err && <Callout tono="warn" ico="⚠">{err}</Callout>}
      {run && (
        <div style={{ marginTop: 12 }}>
          <Callout tono="info" ico="🌓">{run.resumen}</Callout>
          {run.acciones.length > 0 && (
            <>
              <h4>Ajustes que aplicaría (dentro del tope)</h4>
              <ul>{run.acciones.map((a, i) => <li key={i}>{a.actionType} · {a.adRef} — <b>{a.estado}</b> · {a.razon}</li>)}</ul>
            </>
          )}
          {run.recomendacionesFinancieras.length > 0 && (
            <>
              <h4>Requieren tu decisión (más presupuesto)</h4>
              {run.recomendacionesFinancieras.map((r, i) => (
                <Callout key={i} tono="warn" ico="✋">{r.justificacion} <Badge tono="warn">{r.estado}</Badge></Callout>
              ))}
            </>
          )}
          <TechDetails titulo="Evidencia observada">
            <ul>{run.metricas.map((m, i) => <li key={i}>{m.adRef}: {m.calidad} — {m.nota}</li>)}</ul>
          </TechDetails>
        </div>
      )}
    </div>
  );
}
