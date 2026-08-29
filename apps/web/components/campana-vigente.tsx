'use client';
/**
 * SOEC · CENTRO DE MANDO de la campaña VIGENTE. Read-only: consume /api/medicion/campaign-live (single source of
 * truth) y muestra estado, gasto, presupuesto, rendimiento, stop $7.500, protección automática y evolución. La
 * campaña histórica NUNCA se presenta aquí como vigente. Sin datos ⇒ estado vacío profesional (no ceros inventados).
 */
import { useEffect, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Metric, Callout, TrendBars, EmptyState, TechDetails, clp, num, type Tono } from './ui';

interface Stop { enabled: boolean; triggered: boolean }
interface CampaignLive {
  ok: boolean; error?: string; message?: string;
  campaign?: { id: string; resourceName: string; name: string | null; status: string | null; channelType: string | null; startDate: string | null; endDate: string | null; dateSource?: 'GOOGLE' | 'AUTHORIZED' | 'NONE' } | null;
  budget?: { totalClp: number; spentClp: number | null; remainingClp: number | null; spentPercent: number | null };
  performance?: { impressions: number | null; clicks: number | null; ctr: number | null; averageCpcClp: number | null; contacts: number | null; conversions: number | null; costPerContactClp: number | null };
  stops?: {
    zeroContact: Stop & { thresholdClp: number; currentSpendClp: number | null; remainingUntilStopClp: number | null; hasContact: boolean };
    budget: Stop & { capClp: number; currentSpendClp: number | null; remainingClp: number | null };
    period: Stop & { endDate: string | null; remainingDays: number | null };
    tracking: Stop & { valid: boolean }; landing: Stop & { available: boolean };
  };
  monitor?: { active: boolean; status: string; intervalSeconds: number; pauseWired: boolean; lastTickAt: string | null; lastDecision: string | null; lastDecisionReason: string | null; campaignStatusObserved: string | null; spendObserved: number | null; contactsObserved: number | null };
  sync?: { lastGoogleReadAt: string | null; lastFirstPartyReadAt: string | null };
  evolution?: { date: string; spendClp: number; clicks: number; impressions: number }[];
  historical?: { id: string; note: string };
}

const GEO_POS = ['Tarapacá', 'Antofagasta', 'La Araucanía', 'Los Lagos'];
const fecha = (s: string | null | undefined): string => (s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '—');
const hace = (s: string | null | undefined): string => { if (!s) return 'nunca'; const min = Math.round((Date.now() - Date.parse(s)) / 60000); return min < 1 ? 'recién' : min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`; };
const estadoCampana = (s: string | null | undefined): { texto: string; tono: Tono } => s === 'ENABLED' ? { texto: 'HABILITADA', tono: 'ok' } : s === 'PAUSED' ? { texto: 'PAUSADA', tono: 'warn' } : { texto: 'estado desconocido', tono: 'mut' };

export function CampaniaVigente({ org, compact = false }: { org: string; compact?: boolean }): React.ReactElement {
  const [d, setD] = useState<CampaignLive | null>(null);
  const [err, setErr] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/medicion/campaign-live', { headers: cabecerasOrg(org), cache: 'no-store' });
        const j = (await r.json()) as CampaignLive;
        if (vivo) { setD(j); setErr(false); }
      } catch { if (vivo) setErr(true); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [org]);

  if (cargando) return <div className="empty"><div className="et">Cargando campaña vigente…</div></div>;
  // Fail visible: nunca fallback silencioso a la histórica.
  if (err) return <EmptyState ico="⚠" titulo="No pudimos actualizar la campaña vigente." detalle="Reintentá en unos segundos." />;
  // Fail visible ante respuesta ausente, con error, o incompleta: nunca renderizar con un modelo parcial (§11).
  if (!d || d.ok === false || !d.campaign || !d.budget || !d.performance || !d.stops || !d.monitor)
    return <EmptyState ico="◔" titulo={d?.message ?? 'No hay una campaña vigente vinculada.'} detalle="Cuando una campaña quede vinculada al plan, aparecerá aquí." />;

  const c = d.campaign; const b = d.budget; const p = d.performance; const s = d.stops; const mon = d.monitor;
  const est = estadoCampana(c.status);
  const zc = s.zeroContact;
  const zcPct = zc.currentSpendClp != null ? Math.min(100, Math.round((zc.currentSpendClp / zc.thresholdClp) * 100)) : 0;
  const monTono: Tono = mon.status === 'ACTIVE' ? 'ok' : mon.status === 'STALE' ? 'warn' : 'mut';
  const ev = (d.evolution ?? []).map((x) => ({ label: fecha(x.date), value: x.spendClp }));

  return (
    <div className="live">
      {/* Cabecera: campaña vigente + estado */}
      <div className="livehead">
        <div>
          <p className="eyebrow">Campaña vigente · Google Ads</p>
          <h3 className="livename">{c.name ?? 'Experimento SmileFlow'}</h3>
          <p className="livesub">ID {c.id} · {c.channelType ?? 'SEARCH'} · {fecha(c.startDate)} → {fecha(c.endDate ?? s.period.endDate)}{c.dateSource === 'AUTHORIZED' ? ' · fechas autorizadas' : ''}</p>
        </div>
        <Badge tono={est.tono}>{est.texto}</Badge>
      </div>

      {/* KPIs principales */}
      <div className="grid g-4">
        <Metric label="Contactos" value={num(p.contacts)} ico="✉" accent unknown={p.contacts == null} />
        <Metric label="Gasto" value={clp(b.spentClp)} sub={b.spentPercent != null ? `${b.spentPercent}% de ${clp(b.totalClp)}` : `de ${clp(b.totalClp)}`} ico="◉" unknown={b.spentClp == null} />
        <Metric label="Presupuesto restante" value={clp(b.remainingClp)} ico="▮" unknown={b.remainingClp == null} />
        <Metric label="Impresiones" value={num(p.impressions)} ico="◍" unknown={p.impressions == null} />
        <Metric label="Clics" value={num(p.clicks)} ico="➤" unknown={p.clicks == null} />
        <Metric label="CTR" value={p.ctr != null ? `${p.ctr}%` : '—'} unknown={p.ctr == null} />
        <Metric label="Costo por clic" value={clp(p.averageCpcClp)} unknown={p.averageCpcClp == null} />
        <Metric label="Costo por contacto" value={clp(p.costPerContactClp)} unknown={p.costPerContactClp == null} />
      </div>

      {/* STOP sin contactos $7.500 */}
      <div className="stopcard">
        <div className="stophead"><strong>Stop sin contactos</strong><span>{clp(zc.currentSpendClp)} / {clp(zc.thresholdClp)}</span></div>
        <div className="stopbar"><i style={{ width: `${zcPct}%` }} className={zc.triggered ? 'trig' : ''} /></div>
        <p className="stopmsg">{zc.hasContact
          ? 'Se obtuvo al menos un contacto; este stop no está actualmente en condición de disparo.'
          : `SOEC pausará automáticamente al alcanzar ${clp(zc.thresholdClp)} sin contactos.`}</p>
      </div>

      {!compact && (
        <>
          {/* Protección automática (monitor) */}
          <div className="protcard">
            <div className="stophead"><strong>Protección automática</strong><Badge tono={monTono}>{mon.status === 'ACTIVE' ? 'ACTIVA' : mon.status === 'STALE' ? 'DEMORADA' : 'NO DISPONIBLE'}</Badge></div>
            <p className="livesub">Monitor cada {Math.round(mon.intervalSeconds / 60)} min · último chequeo {hace(mon.lastTickAt)} · pausa automática conectada: {mon.pauseWired ? 'Sí' : 'No'}</p>
            {mon.campaignStatusObserved && (
              <p className="livesub">Estado observado por el monitor en el último chequeo: <b>{mon.campaignStatusObserved === 'ENABLED' ? 'HABILITADA' : mon.campaignStatusObserved === 'PAUSED' ? 'PAUSADA' : mon.campaignStatusObserved}</b>{mon.spendObserved != null ? ` · gasto ${clp(mon.spendObserved)}` : ''}{mon.contactsObserved != null ? ` · contactos ${num(mon.contactsObserved)}` : ''}.
                {mon.campaignStatusObserved !== c.status && c.status ? ` La lectura de ahora muestra ${est.texto}: el próximo chequeo lo actualizará.` : ''}</p>
            )}
            <ul className="stoplist">
              <li className={zc.triggered ? 'on' : ''}>${num(zc.thresholdClp)} sin contactos {zc.triggered ? '· en condición de pausa' : ''}</li>
              <li className={s.budget.triggered ? 'on' : ''}>Tope global {clp(s.budget.capClp)} {s.budget.triggered ? '· alcanzado' : ''}</li>
              <li className={s.period.triggered ? 'on' : ''}>Límite temporal {fecha(s.period.endDate)}{s.period.remainingDays != null ? ` · ${s.period.remainingDays} días` : ''}</li>
              <li className={s.tracking.triggered ? 'on' : ''}>Medición {s.tracking.valid ? 'válida' : 'inválida'}</li>
              <li className={s.landing.triggered ? 'on' : ''}>Landing {s.landing.available ? 'disponible' : 'no disponible'}</li>
            </ul>
          </div>

          {/* Evolución */}
          <div className="evocard">
            <p className="eyebrow">Evolución · gasto por día</p>
            {ev.length > 0 ? <TrendBars data={ev} format={clp} /> : <EmptyState ico="◔" titulo="Aún no hay actividad registrada." detalle="Cuando la campaña comience a servir, verás la evolución diaria." />}
          </div>

          {/* Geo */}
          <div className="geocard">
            <p className="eyebrow">Cobertura geográfica</p>
            <div className="geochips">
              {GEO_POS.map((n) => <span className="geochip pos" key={n}>✓ {n}</span>)}
              <span className="geochip neg">✕ Región Metropolitana (excluida)</span>
            </div>
          </div>

          <Callout tono="info" ico="🕓">Última lectura Google: {hace(d.sync?.lastGoogleReadAt)} · contactos: {hace(d.sync?.lastFirstPartyReadAt)}.</Callout>
          {d.historical && <p className="hist-note">Histórico Google Ads (campaña {d.historical.id}): su gasto NO forma parte de este experimento.</p>}

          <TechDetails titulo="Detalle técnico">
            <div>resourceName: {c.resourceName}</div>
            <div>monitor.lastDecision: {mon.lastDecision ?? '—'} ({mon.lastDecisionReason ?? '—'})</div>
          </TechDetails>
        </>
      )}
    </div>
  );
}
