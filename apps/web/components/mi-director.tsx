'use client';
/**
 * SOEC · MI DIRECTOR — superficie principal, recomendación-primero. Consume /api/medicion/director (read-only): el
 * post-mortem, el diagnóstico y la recomendación salen del MOTOR del backend (no de un LLM ni de textos fijos aquí).
 * Responde de un vistazo: qué pasó, qué aprendimos, qué recomienda SOEC, por qué, qué costaría, qué riesgo, qué
 * necesita de mí. Sin recomendación ⇒ "No necesitas decidir nada; SOEC está observando".
 */
import { useEffect, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout, Metric, EmptyState, TechDetails, clp, num, type Tono } from './ui';

interface Recomendacion {
  action: string; why: string; evidence: string[]; confidence: string; expectedEffect: string;
  risk: string; estimatedCostClp: number | null; humanApprovalRequired: boolean; usedLearnings: string[];
}
interface DecisionPack { decision: string; reason: string; proposedChanges: string[]; maxNewCommitmentClp: number | null; historicalCampaignBudgetClp: number | null; historicalSpendClp: number | null; providerWritesExpected: number; expectedSampleClicks: string; risk: string }
interface DecisionResumen { decisionId: string; decisionStatus: string; decisionType: string; financialCommitmentClp: number }
interface PostMortem {
  metrics: { spend: number | null; campaignTotalSpend: number | null; stopThreshold: number | null; budget: number | null; impressions: number | null; clicks: number | null; ctr: number | null; avgCpcClp: number | null; contacts: number | null; conversions: number | null; cpaClp: number | null };
  biddingBefore: number | null; biddingAfter: number | null; biddingControlWorked: boolean | null;
  trafficQuality: string;
  keywordConcentration: { keyword: string; matchType: string | null; sharePct: number; gasto: number }[];
  searchTermFindings: { termino: string; intent: string; gasto: number | null; shareCampaignPct: number | null }[];
  searchTermPrivacy: { reportedSpend: number | null; unreportedSpend: number | null; unreportedPct: number | null; epistemic: string };
  sample: { confidence: string; suficienteParaConcluirNoConvierte: boolean; porque: string }; causalConfidence: string;
  diagnosis: { factor: string; evidencia: string; confianza: string; epistemic: string }[];
  stopReason: string | null; restartRecommended: boolean;
  analyzedPhaseLabel?: string | null; phaseSegmentation?: string;
}
interface DirectorResp {
  ok: boolean; error?: string; message?: string; campaignId?: string; campaignName?: string | null; status?: string | null; createdAt?: string;
  postMortem?: PostMortem; recomendacion?: Recomendacion; decisionPack?: DecisionPack | null;
  eventos?: { evento: string; outcome: string; detalle: string }[];
  decision?: DecisionResumen | null;
  notificaciones?: { at: string; tipo: string; mensaje: string }[];
}
const NO_COMERCIAL = new Set(['NAVIGATIONAL', 'IRRELEVANT', 'LOW_COMMERCIAL_INTENT']);

const ACCION_ES: Record<string, string> = {
  KEEP_RUNNING: 'Mantener la campaña', PAUSE: 'Pausar', DO_NOT_RESTART: 'No reanudar', PREPARE_EXPERIMENT_2: 'Preparar Experimento 2',
  CHANGE_BIDDING: 'Cambiar la puja', RESTRICT_MATCH_TYPES: 'Restringir concordancias', ADD_NEGATIVES: 'Agregar negativas',
  CHANGE_AD: 'Cambiar el anuncio', CHANGE_LANDING: 'Cambiar la landing', COLLECT_MORE_DATA: 'Reunir más datos',
  STOP_MARKETING_CHANNEL: 'Detener el canal',
};
const CALIDAD_ES: Record<string, string> = { GOOD: 'buena', MIXED: 'mixta', POOR: 'poco cualificada', UNKNOWN: 'sin datos suficientes' };

export function MiDirector({ org }: { org: string }): React.ReactElement {
  const [d, setD] = useState<DirectorResp | null>(null);
  const [err, setErr] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [verProp, setVerProp] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/medicion/director', { headers: cabecerasOrg(org), cache: 'no-store' });
        const j = (await r.json()) as DirectorResp;
        if (vivo) { setD(j); setErr(false); }
      } catch { if (vivo) setErr(true); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [org]);

  if (cargando) return <div className="empty"><div className="et">SOEC está analizando…</div></div>;
  if (err) return <EmptyState ico="⚠" titulo="No pudimos actualizar el análisis del Director." detalle="Reintentá en unos segundos." />;
  if (!d || d.ok === false || !d.recomendacion || !d.postMortem) {
    return <EmptyState ico="👁" titulo="No necesitas tomar ninguna decisión ahora." detalle="SOEC está observando. Cuando haya algo real que decidir, aparecerá acá con su porqué, su costo y su riesgo." />;
  }
  const pm = d.postMortem; const rec = d.recomendacion; const m = pm.metrics;
  // La decisión VIGENTE manda (SSOT): sólo pedimos aprobación si hay una decisión PENDING. Si fue rechazada/resuelta,
  // no volvemos a exigirla aunque el motor siga recomendando lo mismo.
  const decisionPendiente = !!d.decision && d.decision.decisionStatus === 'PENDING';
  const recTono: Tono = decisionPendiente ? 'warn' : 'ok';
  const faseTxt = pm.analyzedPhaseLabel === 'PHASE_2' ? 'fase reciente' : pm.analyzedPhaseLabel ? 'fase analizada' : 'campaña';

  const notif = decisionPendiente ? (d.notificaciones ?? []).find((n) => n.tipo === 'DECISION_REQUIRED') : undefined;
  return (
    <div className="live">
      {notif && <Callout tono="warn" ico="🔔">{notif.mensaje}</Callout>}
      {/* SOEC RECOMIENDA AHORA — recomendación prioritaria, arriba de todo */}
      <div className="livehead">
        <div>
          <p className="eyebrow">SOEC recomienda ahora</p>
          <h3 className="livename">{ACCION_ES[rec.action] ?? rec.action}</h3>
          <p className="livesub">{rec.why}</p>
        </div>
        <Badge tono={recTono}>{decisionPendiente ? 'SOEC NECESITA TU DECISIÓN' : rec.humanApprovalRequired ? 'DECISIÓN REGISTRADA' : 'SOEC PUEDE HACERLO SOLO'}</Badge>
      </div>

      {/* Post-mortem: qué pasó. NO confundir el umbral de stop, el gasto TOTAL de campaña y el gasto de la fase. */}
      <div className="stopcard">
        <div className="stophead"><strong>{pm.stopReason ? 'Experimento finalizado' : 'Estado del experimento'}</strong>
          {pm.stopReason && <Badge tono="warn">SOEC detuvo la campaña</Badge>}</div>
        <div className="grid g-4" style={{ marginTop: 6 }}>
          <Metric label="Gasto de campaña" value={clp(m.campaignTotalSpend)} sub={m.budget != null ? `de ${clp(m.budget)}` : undefined} unknown={m.campaignTotalSpend == null} />
          <Metric label={`Gasto ${faseTxt}`} value={clp(m.spend)} sub={m.clicks != null ? `${num(m.clicks)} clics` : undefined} unknown={m.spend == null} />
          <Metric label="Contactos" value={num(m.contacts)} accent unknown={m.contacts == null} />
          <Metric label="Costo por contacto" value={clp(m.cpaClp)} unknown={m.cpaClp == null} />
        </div>
        {pm.stopReason === 'STOP_ZERO_CONVERSION' && (
          <p className="stopmsg">SOEC pausó la campaña al superar el stop de {clp(m.stopThreshold)} sin contactos. Gasto final de campaña: {clp(m.campaignTotalSpend)}. En la {faseTxt} (control de CPC): {clp(m.spend)} / {num(m.clicks)} clics.</p>
        )}
        {pm.stopReason && pm.stopReason !== 'STOP_ZERO_CONVERSION' && <p className="stopmsg">Motivo: {pm.stopReason}</p>}
      </div>

      {/* Qué aprendimos — KEYWORD, SEARCH TERM y PRIVACIDAD por separado (nunca se confunden). */}
      <div className="protcard">
        <div className="stophead"><strong>Qué aprendimos</strong></div>
        <ul className="stoplist">
          {pm.biddingControlWorked === true && <li className="on">✓ El control de CPC funcionó: {clp(pm.biddingBefore)} → ~{clp(pm.biddingAfter)}.</li>}
          {pm.keywordConcentration.map((k, i) => <li key={`k${i}`} className="on">⚠ La <b>keyword</b> «{k.keyword}»{k.matchType ? ` (${k.matchType})` : ''} concentró {Math.round(k.sharePct)}% del gasto sin contactos.</li>)}
          {pm.searchTermFindings.filter((t) => NO_COMERCIAL.has(t.intent)).map((t, i) => <li key={`t${i}`}>El <b>término</b> visible «{t.termino}» = {t.intent}{t.gasto != null ? ` (${clp(t.gasto)}${t.shareCampaignPct != null ? `, ${t.shareCampaignPct}% del gasto` : ''})` : ''}.</li>)}
          {pm.searchTermPrivacy.unreportedPct != null && pm.searchTermPrivacy.unreportedPct > 0 && <li>{pm.searchTermPrivacy.unreportedPct}% del gasto está en términos <b>no divulgados</b> por privacidad de Google (desconocido a nivel término).</li>}
          <li>Tráfico visible: calidad <b>{CALIDAD_ES[pm.trafficQuality] ?? pm.trafficQuality}</b> · confianza causal {pm.causalConfidence}.</li>
          <li>{pm.sample.porque}</li>
        </ul>
      </div>

      {/* Conclusión + por qué / costo / riesgo / qué necesita de mí */}
      <div className="evocard">
        <p className="eyebrow">Por qué esta recomendación</p>
        <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {rec.evidence.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
        </ul>
        <div className="grid g-4" style={{ marginTop: 10 }}>
          <Metric label="Efecto esperado" value={rec.expectedEffect} />
          <Metric label="Riesgo" value={rec.risk} />
          <Metric label="Costo estimado" value={rec.estimatedCostClp != null ? `hasta ${clp(rec.estimatedCostClp)}` : '—'} />
          <Metric label="Confianza" value={rec.confidence} />
        </div>
        {rec.usedLearnings.length > 0 && <Callout tono="info" ico="🧠">Incorpora aprendizajes previos: {rec.usedLearnings.slice(0, 2).join(' · ')}.</Callout>}
      </div>

      {/* Decision pack: listo para aprobar — SÓLO si la decisión vigente está PENDING (SSOT). */}
      {d.decisionPack && decisionPendiente && (
        <div className="geocard">
          <div className="spread"><p className="eyebrow">Qué necesita de vos</p><Badge tono="warn">Requiere tu aprobación</Badge></div>
          <p className="livesub" style={{ marginTop: 4 }}>{d.decisionPack.decision}</p>
          <button type="button" className="btn" onClick={() => setVerProp((v) => !v)}>{verProp ? 'Ocultar propuesta' : 'Ver propuesta'}</button>
          {verProp && (
            <div style={{ marginTop: 8 }}>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {d.decisionPack.proposedChanges.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <p className="s" style={{ marginTop: 6 }}>Nuevo compromiso financiero: <b>{clp(d.decisionPack.maxNewCommitmentClp ?? 0)}</b> · Escrituras a Google al aprobar: <b>{d.decisionPack.providerWritesExpected}</b> · Riesgo: {d.decisionPack.risk}</p>
              {(d.decisionPack.historicalCampaignBudgetClp != null || d.decisionPack.historicalSpendClp != null) && (
                <p className="s muted" style={{ marginTop: 4 }}>Contexto histórico (no es compromiso nuevo): presupuesto anterior {clp(d.decisionPack.historicalCampaignBudgetClp)} · ya gastado {clp(d.decisionPack.historicalSpendClp)}.</p>
              )}
              <p className="s muted" style={{ marginTop: 6 }}>La aprobación se hace en «Decisiones» (SOEC no gasta ni crea nada sin tu confirmación explícita).</p>
            </div>
          )}
        </div>
      )}

      <TechDetails titulo="Diagnóstico técnico">
        <div>Calidad tráfico: {pm.trafficQuality} · muestra: {pm.sample.confidence} · reanudar tal cual: {pm.restartRecommended ? 'sí' : 'no'}</div>
        {pm.diagnosis.map((x, i) => <div key={i}>{x.factor} ({x.confianza}): {x.evidencia}</div>)}
      </TechDetails>
    </div>
  );
}
