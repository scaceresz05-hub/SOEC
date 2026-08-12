'use client';

/**
 * /resultados — PANEL de datos REALES ya persistidos (Google Ads + SmileFlow Growth).
 * Solo PRESENTACIÓN: consulta /api/medicion/panel y renderiza lo observado. No calcula
 * atribución, no fabrica recomendaciones, no mezcla con la demostración simulada.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Campaign { name: string | null; status: string | null; id: string | null }
interface Ads { impressions: number | null; clicks: number | null; cost: number | null; ctr: number | null; cpc: number | null; sinDatos: boolean }
interface FunnelCounts { demo_cta_clicked: number; demo_form_started: number; demo_requested: number; lead_created: number }
interface GrowthFunnel { comercial: FunnelCounts; diagnostico: FunnelCounts }
interface SearchTerm { termino: string; impresiones: number; clics: number }
interface Atribucion { demosAtribuiblesAds: null; costePorDemo: null; estado: string }
interface Sync { provider: string; ok: boolean | null; at: string | null; estado?: 'OK' | 'PARCIAL' | 'FALLO' | null }
interface Panel {
  campaign: Campaign; ads: Ads; growthFunnel: GrowthFunnel; searchTerms: SearchTerm[];
  atribucion: Atribucion; sincronizaciones: Sync[]; lecturaSoec: string; modo: string;
}
interface LecturaDirector {
  veredicto: 'NO_EVALUABLE' | 'OBSERVAR' | 'RECOMENDAR';
  naturaleza?: 'REAL'; motivo?: string;
  hechos?: { impresiones: number; clics: number; gasto: number; ctr: number | null; cpc: number | null; conversionesAtribuiblesAds: number };
  interpretacion?: { clasificacionDesempeno: string; roi: { clasificacion: string; motivo: string }; calidad: string; evidenciaSuficiente: boolean; explicacion: string; limitaciones: string[]; faltantes: string[]; estadoGobernanza: string };
  recomendacion?: { tipo: string; motivo: string; evidencia: string; confianza: string; estado: string } | null;
}
interface PlanItem {
  intencion: {
    palanca: string; entidadRef: string; riesgo: string; confianza: string;
    problema: string; recomendacion: string; impactoEsperado: string; riesgoExplicacion: string; rollbackPrevisto: string;
    valorAntes: string; valorDespues: string; evidencia: { resumen: string; suficiente: boolean };
    limitesAplicados: string[]; detalleTecnico: { operacion: string; descripcionMutate: string };
  };
  gates: { bloqueos: string[]; puedeEjecutarReal: boolean; modo: string };
  aprobacion: { requerida: boolean; simulada: boolean; actor: string | null; nota: string };
  simulacion: { ejecutado: boolean; mutateSimulado: string; antes: string; despues: string; rollback: { descripcion: string } };
}
interface PlanAccion {
  modo: string; autonomousReal: boolean; perfil?: string; totalPropuestas: number; resumenSimple: string; items: PlanItem[];
}

const num = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const pct = (n: number | null): string => (n === null ? '—' : `${(n * 100).toFixed(2)} %`);
const clp = (n: number | null): string => (n === null ? '—' : `$${Math.round(n).toLocaleString('es-CL')} CLP`);

const FUNNEL_PASOS: Array<{ k: keyof FunnelCounts; label: string }> = [
  { k: 'demo_cta_clicked', label: 'CTA demo' },
  { k: 'demo_form_started', label: 'Formularios iniciados' },
  { k: 'demo_requested', label: 'Demos solicitadas' },
  { k: 'lead_created', label: 'Leads creados' },
];

function Tarjeta({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }): React.ReactElement {
  return (
    <div className="card" style={{ padding: '14px 16px', minWidth: 0 }}>
      <p className="s" style={{ margin: 0, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-faint)' }}>{titulo}</p>
      <p style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 600, fontFamily: 'var(--voice)' }}>{valor}</p>
      {nota ? <p className="s" style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-faint)' }}>{nota}</p> : null}
    </div>
  );
}

const VEREDICTO_META: Record<string, { label: string; cls: string }> = {
  NO_EVALUABLE: { label: 'No evaluable', cls: 'mut' },
  OBSERVAR: { label: 'Observar', cls: 'warn' },
  RECOMENDAR: { label: 'Recomendar', cls: 'ok' },
};

export default function Resultados(): React.ReactElement {
  const [d, setD] = useState<Panel | null>(null);
  const [ld, setLd] = useState<LecturaDirector | null>(null);
  const [plan, setPlan] = useState<PlanAccion | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/medicion/panel', { cache: 'no-store' });
        if (!r.ok) { setError('No se pudo cargar el panel de resultados.'); return; }
        setD((await r.json()) as Panel);
      } catch { setError('No se pudo contactar el servicio.'); }
    })();
    (async () => {
      try {
        const r = await fetch('/api/medicion/lectura-director', { cache: 'no-store' });
        if (r.ok) setLd((await r.json()) as LecturaDirector);
      } catch { /* la lectura del Director es opcional; el panel funciona sin ella */ }
    })();
    (async () => {
      try {
        const r = await fetch('/api/medicion/plan-accion', { cache: 'no-store' });
        if (r.ok) setPlan((await r.json()) as PlanAccion);
      } catch { /* el plan de acción es opcional */ }
    })();
  }, []);

  if (error) return <div className="wrap panel"><p className="lede">{error}</p><p><Link href="/">← Volver al inicio</Link></p></div>;
  if (!d) return <div className="wrap panel"><p className="lede">Cargando resultados reales…</p></div>;

  const gridCols = { display: 'grid', gap: 10 } as const;
  const sinTerminos = d.searchTerms.length === 0;

  return (
    <div className="wrap panel">
      <p className="eyebrow">Resultados reales · Google Ads + SmileFlow Growth</p>

      {/* Cabecera de campaña */}
      <h1 className="voice">{d.campaign.name ?? 'Sin campaña registrada'}</h1>
      <p className="lede" style={{ marginBottom: 18, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {d.campaign.status ? (
          <span className={`pill ${d.campaign.status === 'ENABLED' ? 'ok' : 'mut'}`}>
            {d.campaign.status === 'ENABLED' ? 'Habilitada' : d.campaign.status}
          </span>
        ) : null}
        <span className="pill mut">Google Ads · REAL</span>
        <span className="pill ok" style={{ fontSize: 10.5 }}>Datos reales</span>
        {d.campaign.id ? <span className="s" style={{ fontSize: 12, color: 'var(--ink-faint)' }}>ID de campaña: {d.campaign.id}</span> : null}
      </p>

      {/* Lectura del Director SOEC (sobre evidencia REAL) */}
      {ld ? (
        <>
          <h2 className="block">Lectura del Director SOEC</h2>
          <div className="card" style={{ padding: '14px 16px' }}>
            <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="s" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-faint)' }}>Veredicto</span>
              <span className={`pill ${VEREDICTO_META[ld.veredicto]?.cls ?? 'mut'}`} style={{ fontSize: 12, fontWeight: 600 }}>{VEREDICTO_META[ld.veredicto]?.label ?? ld.veredicto}</span>
              <span className="pill ok" style={{ fontSize: 10.5 }}>Evidencia {ld.naturaleza ?? 'REAL'}</span>
            </p>

            {ld.motivo && !ld.hechos ? <p className="note" style={{ marginTop: 10 }}>{ld.motivo}</p> : null}

            {ld.hechos ? (
              <p className="s" style={{ margin: '12px 0 4px', fontWeight: 600, color: 'var(--ink-soft)' }}>1 · Hechos reales</p>
            ) : null}
            {ld.hechos ? (
              <p className="s" style={{ margin: 0 }}>
                {num(ld.hechos.impresiones)} impresiones · {num(ld.hechos.clics)} clics · {clp(ld.hechos.gasto)} · CTR {pct(ld.hechos.ctr)} · CPC {clp(ld.hechos.cpc)} · {ld.hechos.conversionesAtribuiblesAds} conversiones atribuibles a Ads
              </p>
            ) : null}

            {ld.interpretacion ? (
              <>
                <p className="s" style={{ margin: '12px 0 4px', fontWeight: 600, color: 'var(--ink-soft)' }}>2 · Interpretación de SOEC</p>
                <p className="s" style={{ margin: 0 }}>{ld.interpretacion.explicacion}</p>
                <p className="s" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}>
                  Desempeño: <b>{ld.interpretacion.clasificacionDesempeno}</b> · ROI: <b>{ld.interpretacion.roi.clasificacion}</b> ({ld.interpretacion.roi.motivo}) · Calidad: <b>{ld.interpretacion.calidad}</b> · Evidencia suficiente: <b>{ld.interpretacion.evidenciaSuficiente ? 'sí' : 'no'}</b>
                </p>
                {ld.interpretacion.limitaciones.length > 0 ? (
                  <p className="s" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}>Limitaciones: {ld.interpretacion.limitaciones.join(' · ')}</p>
                ) : null}
                {ld.interpretacion.faltantes.length > 0 ? (
                  <p className="s" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}>Faltan: {ld.interpretacion.faltantes.join(' · ')}</p>
                ) : null}
              </>
            ) : null}

            <p className="s" style={{ margin: '12px 0 4px', fontWeight: 600, color: 'var(--ink-soft)' }}>3 · Recomendación</p>
            {ld.recomendacion ? (
              <p className="s" style={{ margin: 0 }}>
                <b>{ld.recomendacion.tipo}</b> — {ld.recomendacion.motivo}{' '}
                <span className="pill warn" style={{ fontSize: 10.5 }}>{ld.recomendacion.estado}</span>
              </p>
            ) : (
              <p className="s" style={{ margin: 0, color: 'var(--ink-faint)' }}>Ninguna. La evidencia real todavía no justifica modificar la campaña; SOEC observa. No se ejecuta ninguna acción sobre Google Ads.</p>
            )}
          </div>
        </>
      ) : null}

      {/* Plan de acción (G1 · SIMULACIÓN, sin efecto real) */}
      {plan ? (
        <>
          <h2 className="block">Plan de acción <span className="pill mut" style={{ fontSize: 10.5 }}>SIMULACIÓN · no se ejecuta nada</span></h2>
          <div className="card" style={{ padding: '14px 16px' }}>
            <p className="s" style={{ margin: 0 }}>{plan.resumenSimple}</p>
            {plan.items.length === 0 ? null : (
              <div className="stack" style={{ marginTop: 12 }}>
                {plan.items.map((it, i) => {
                  const rk = it.intencion.riesgo;
                  const rkCls = rk === 'bajo' ? 'ok' : rk === 'alto' ? 'warn' : 'mut';
                  return (
                    <div key={i} className="card" style={{ padding: '12px 14px', borderLeft: '3px solid var(--line)' }}>
                      <p className="s" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={`pill ${rkCls}`} style={{ fontSize: 10.5 }}>Riesgo {rk}</span>
                        <span className="pill mut" style={{ fontSize: 10.5 }}>Confianza {it.intencion.confianza}</span>
                        {it.aprobacion.requerida ? <span className="pill warn" style={{ fontSize: 10.5 }}>Requiere tu aprobación</span> : null}
                        <span className="pill mut" style={{ fontSize: 10.5 }}>DRY-RUN · no ejecutado</span>
                      </p>
                      <p className="s" style={{ margin: '8px 0 0' }}><b>Problema:</b> {it.intencion.problema}</p>
                      <p className="s" style={{ margin: '4px 0 0' }}><b>Recomendación:</b> {it.intencion.recomendacion}</p>
                      <p className="s" style={{ margin: '4px 0 0' }}><b>Qué se espera:</b> {it.intencion.impactoEsperado}</p>
                      <p className="s" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}><b>Riesgo:</b> {it.intencion.riesgoExplicacion}</p>
                      <p className="s" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}><b>Si sale mal:</b> {it.intencion.rollbackPrevisto}</p>
                      <details style={{ marginTop: 6 }}>
                        <summary className="s" style={{ cursor: 'pointer', color: 'var(--ink-faint)' }}>Detalle técnico</summary>
                        <p className="s" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }}>
                          Antes: {it.simulacion.antes} → Después: {it.simulacion.despues}<br />
                          Evidencia: {it.intencion.evidencia.resumen}<br />
                          Operación (simulada, NO enviada): <code>{it.simulacion.mutateSimulado}</code><br />
                          Rollback previsto: {it.simulacion.rollback.descripcion}<br />
                          Límites aplicados: {it.intencion.limitesAplicados.join(' · ')}<br />
                          Aprobación simulada por: {it.aprobacion.actor ?? '—'} · Gates que bloquearían el efecto real: {it.gates.bloqueos.join(', ') || 'ninguno'}
                        </p>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="s" style={{ margin: '10px 0 0', color: 'var(--ink-faint)' }}>
              Etapa G1 (asistido, simulación): la escritura real en Google Ads está <b>desactivada</b>. SOEC nunca ejecuta nada sin tu aprobación.
            </p>
          </div>
        </>
      ) : null}

      {/* Tarjetas Google Ads */}
      <h2 className="block">Google Ads</h2>
      <div style={{ ...gridCols, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Tarjeta titulo="Impresiones" valor={num(d.ads.impressions)} nota={d.ads.sinDatos ? 'Sin datos todavía' : undefined} />
        <Tarjeta titulo="Clics" valor={num(d.ads.clicks)} nota={d.ads.sinDatos ? 'Sin datos todavía' : undefined} />
        <Tarjeta titulo="CTR" valor={pct(d.ads.ctr)} />
        <Tarjeta titulo="CPC medio" valor={clp(d.ads.cpc)} />
        <Tarjeta titulo="Coste" valor={clp(d.ads.cost)} />
      </div>
      {d.ads.sinDatos ? (
        <p className="note" style={{ marginTop: 12 }}>La campaña aún no registra impresiones, clics ni coste. Los ceros son reales (la campaña está publicada pero todavía no sirve).</p>
      ) : null}

      {/* Embudo Growth */}
      <h2 className="block">Embudo Growth (comercial)</h2>
      <div className="card" style={{ padding: '10px 16px' }}>
        <div style={{ ...gridCols, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', alignItems: 'stretch' }}>
          {FUNNEL_PASOS.map((p, i) => (
            <div key={p.k} style={{ padding: '8px 4px' }}>
              <p className="s" style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-faint)' }}>{i + 1}. {p.label}</p>
              <p style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 600, fontFamily: 'var(--voice)' }}>{d.growthFunnel.comercial[p.k]}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="s" style={{ margin: '10px 0 0', color: 'var(--ink-soft)' }}>
        Conteos de diagnóstico (TEST · <b>no aprende</b>, no entran en los totales comerciales):{' '}
        {FUNNEL_PASOS.map((p) => (
          <span key={p.k} className="pill mut" style={{ fontSize: 10.5, marginRight: 4 }}>{p.label}: {d.growthFunnel.diagnostico[p.k]}</span>
        ))}
      </p>

      {/* Atribución pagada */}
      <h2 className="block">Atribución pagada</h2>
      <div className="card" style={{ padding: '14px 16px' }}>
        <p className="s" style={{ margin: 0 }}>Demos atribuibles a Google Ads = <b>No disponible todavía</b></p>
        <p className="s" style={{ margin: '4px 0 0' }}>Coste por demo = <b>No evaluable</b></p>
        <p className="s" style={{ margin: '8px 0 0' }}>
          <span className="pill warn" style={{ fontSize: 10.5 }}>ATRIBUCION_ADS_GROWTH = {d.atribucion.estado}</span>
        </p>
      </div>

      {/* Términos de búsqueda reales */}
      <h2 className="block">Términos de búsqueda reales</h2>
      {sinTerminos ? (
        <p className="note">
          {(d.ads.impressions ?? 0) > 0
            ? 'Sin términos de búsqueda disponibles todavía para la ventana consultada.'
            : 'Todavía no hay términos de búsqueda: la campaña aún no registra impresiones.'}
        </p>
      ) : (
        <div className="card" style={{ padding: '6px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-faint)' }}>
                <th style={{ padding: '8px 4px', fontWeight: 600 }}>Término</th>
                <th style={{ padding: '8px 4px', fontWeight: 600, textAlign: 'right' }}>Impresiones</th>
                <th style={{ padding: '8px 4px', fontWeight: 600, textAlign: 'right' }}>Clics</th>
              </tr>
            </thead>
            <tbody>
              {d.searchTerms.map((t) => (
                <tr key={t.termino} style={{ borderTop: '1px solid var(--line-soft)' }}>
                  <td style={{ padding: '8px 4px' }}>{t.termino}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>{t.impresiones.toLocaleString('es-CL')}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>{t.clics.toLocaleString('es-CL')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Última sincronización */}
      <h2 className="block">Última sincronización</h2>
      <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {d.sincronizaciones.map((s) => {
          const parcial = s.estado === 'PARCIAL';
          const cls = parcial ? 'warn' : s.ok ? 'ok' : s.ok === false ? 'warn' : 'mut';
          const icono = parcial ? '◐' : s.ok ? '✓' : s.ok === false ? '✗' : '—';
          return (
            <span key={s.provider} className={`pill ${cls}`} style={{ fontSize: 11 }}>
              {s.provider} {icono}{parcial ? ' parcial' : ''} {s.at ? new Date(s.at).toLocaleString('es-CL') : 'sin datos'}
            </span>
          );
        })}
        <span className="pill ok" style={{ fontSize: 10.5, marginLeft: 'auto' }}>Datos reales</span>
      </div>

      {/* Lectura de SOEC */}
      <h2 className="block">Lectura de SOEC</h2>
      <p className="note">{d.lecturaSoec}</p>

      <p className="sim">Datos <b>REALES</b> ya persistidos por la ingesta autónoma. Esta pantalla solo los <b>consulta</b>: no publica, no gasta ni ejecuta nada. <Link href="/">← Volver al inicio</Link></p>
    </div>
  );
}
