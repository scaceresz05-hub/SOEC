'use client';

/**
 * OPERADOR DE CAMPAÑA (SIMULACIÓN / DRY-RUN). El humano ingresa OBJETIVO + PRESUPUESTO + PERÍODO y SOEC
 * produce un PLAN operable (hipótesis, draft, keywords/negativas, guardrails numéricos) separando claramente
 * PLANIFICACIÓN de EJECUCIÓN (un canal puede planificarse aunque su ejecución esté bloqueada por un gate
 * externo). SIN gastar ni escribir nada. La ejecución real controlada es un paso posterior.
 */
import { useCallback, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout } from './ui';

interface AsignacionCanal { canal: string; disponible: boolean; presupuesto: number; motivo: string }
interface StopRule { id: string; tipo: string; descripcion: string; enabled: boolean; threshold?: number | null; reason?: string }
interface KeywordEntry { text: string; matchType: string; rationale: string }
interface Campaign {
  channel: string; campaignName: string; objective: string; campaignType: string; hypothesisId: string; budget: number;
  adGroups: { name: string; intent: string; keywords: KeywordEntry[] }[];
  negativeKeywords: { text: string; rationale: string }[];
  ads: { headlines: string[]; descriptions: string[] }[];
  finalDestination: string;
}
interface Hypothesis { id: string; category: string; statement: string; evidenceStrength: string; score: number }
interface MarketingPlan {
  objective: string; totalAuthorizedBudget: number; currency: string;
  planStatus: 'DIAGNOSIS_REQUIRED' | 'READY_FOR_APPROVAL'; executionStatus: string;
  channelExecutionAvailability: { canal: string; canExecute: boolean; executionGate: string }[];
  recommendedChannelMix: AsignacionCanal[]; totalSpendRecommended: number; spendRecommendation: string;
  selectedHypothesis: Hypothesis | null; backlogHypotheses: Hypothesis[];
  keywordDecisions: { categoria: string; action: string; reason: string; examples: string[] }[];
  maxSpendWithoutContact: { value: number; rationale: string };
  targetCpa: { kind: string; value?: number; rationale: string };
  successCriteria: { minimumRealContacts: number; maxSpend: number; measurementWindowDays: number; attributionRequirement: string };
  stopCriteria: StopRule[]; campaigns: Campaign[];
  reasoning: { facts: string[]; hypotheses: string[] }; readinessSummary: string;
}
interface Resultado { modo: string; autonomousReal: boolean; plan: MarketingPlan | null; envelopeDraft: { status: string; executionEligibleChannels: string[]; allowedChannelsPlanned: string[] } | null }

const clp = (n: number): string => `$${Math.round(n).toLocaleString('es-CL')}`;
const nombreCanal = (c: string): string => (c === 'google' ? 'Google Ads' : c === 'meta' ? 'Meta Ads' : c);
const gateHumano: Record<string, string> = {
  READY: 'lista', ADVERTISER_VERIFICATION_PENDING: 'Google está verificando al anunciante',
  OAUTH_REQUIRED: 'falta conectar la cuenta', ACCOUNT_PAUSED: 'cuenta pausada',
  PROVIDER_NOT_CONNECTED: 'canal no conectado', PROVIDER_POLICY_BLOCKED: 'bloqueada por política', UNKNOWN: 'estado desconocido',
};

export function CampaignOperator({ org }: { org: string | null | undefined }): React.ReactElement {
  const [objetivo, setObjetivo] = useState('Conseguir clínicas dentales interesadas en SmileFlow');
  const [presupuesto, setPresupuesto] = useState(30000);
  const [dias, setDias] = useState(10);
  const [cargando, setCargando] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const simular = useCallback(async () => {
    if (!org) { setError('No hay una empresa activa.'); return; }
    setCargando(true); setError(null);
    try {
      const r = await fetch('/api/medicion/campaign-operator-plan', {
        method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
        body: JSON.stringify({ objetivo, presupuestoTotal: presupuesto, periodoDias: dias }),
      });
      const j = (await r.json().catch(() => ({}))) as Resultado & { error?: string };
      if (!r.ok || j.error) { setError('No se pudo generar el plan. Probá de nuevo.'); return; }
      setRes(j);
    } catch { setError('No se pudo contactar el servicio.'); }
    finally { setCargando(false); }
  }, [org, objetivo, presupuesto, dias]);

  const plan = res?.plan;
  const googleExec = plan?.channelExecutionAvailability.find((c) => c.canal === 'google');
  const camp = plan?.campaigns[0];
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="spread">
        <div className="section" style={{ margin: 0 }}>Preparar experimento de campaña <span className="hint">simulación · no gasta dinero</span></div>
        <Badge tono="info">DRY-RUN</Badge>
      </div>
      <div className="grid g-3" style={{ marginTop: 12 }}>
        <label className="s">Objetivo<input className="field" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} /></label>
        <label className="s">Presupuesto total (CLP)<input className="field" type="number" min={0} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value))} /></label>
        <label className="s">Período (días)<input className="field" type="number" min={1} value={dias} onChange={(e) => setDias(Number(e.target.value))} /></label>
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={cargando} onClick={() => void simular()}>{cargando ? 'Preparando…' : 'Simular plan (sin gastar)'}</button>
      </div>
      {error && <Callout tono="warn" ico="⚠">{error}</Callout>}

      {plan && (
        <div style={{ marginTop: 16 }}>
          {/* PLAN vs EJECUCIÓN, separados. */}
          <div className="grid g-2">
            <div className="card" style={{ background: 'var(--bg-soft, #f8fafc)' }}>
              <div className="spread"><b>PLAN</b><Badge tono={plan.planStatus === 'READY_FOR_APPROVAL' ? 'ok' : 'warn'}>{plan.planStatus === 'READY_FOR_APPROVAL' ? 'Listo para aprobación' : 'Diagnóstico requerido'}</Badge></div>
              <p className="s" style={{ marginTop: 6 }}>{plan.spendRecommendation}</p>
            </div>
            <div className="card" style={{ background: 'var(--bg-soft, #f8fafc)' }}>
              <div className="spread"><b>EJECUCIÓN</b><Badge tono={plan.executionStatus === 'READY' ? 'ok' : 'warn'}>{plan.executionStatus === 'READY' ? 'Habilitada' : 'Bloqueada'}</Badge></div>
              <p className="s" style={{ marginTop: 6 }}>{googleExec && !googleExec.canExecute ? `Google Ads: ${gateHumano[googleExec.executionGate] ?? googleExec.executionGate}.` : 'Ejecución supeditada a aprobación humana.'} SOEC no ejecuta ni gasta.</p>
            </div>
          </div>

          {plan.planStatus === 'DIAGNOSIS_REQUIRED' ? (
            <Callout tono="warn" ico="🔍" >Primero registrar el resultado del diagnóstico del funnel; no invertir todavía. {plan.readinessSummary}</Callout>
          ) : (
            <>
              {plan.selectedHypothesis && (
                <>
                  <div className="section" style={{ marginTop: 14 }}>Hipótesis a probar <span className="hint">una primaria · evidencia {plan.selectedHypothesis.evidenceStrength}</span></div>
                  <p className="s" style={{ margin: '4px 0 0' }}>{plan.selectedHypothesis.statement}</p>
                  {plan.backlogHypotheses.length > 0 && <p className="s muted" style={{ margin: '4px 0 0' }}>Backlog: {plan.backlogHypotheses.map((h) => h.category).join(' · ')}</p>}
                </>
              )}

              <div className="section" style={{ marginTop: 14 }}>Presupuesto del experimento <span className="hint">tope autorizado {clp(plan.totalAuthorizedBudget)}</span></div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {plan.recommendedChannelMix.map((m) => <li key={m.canal}><b>{nombreCanal(m.canal)}:</b> {clp(m.presupuesto)} — {m.motivo}</li>)}
                <li>Corte por gasto sin contacto: <b>{clp(plan.maxSpendWithoutContact.value)}</b> — {plan.maxSpendWithoutContact.rationale}</li>
                <li>CPA objetivo: <b>{plan.targetCpa.kind === 'VALUE' ? clp(plan.targetCpa.value ?? 0) : 'sin definir (evidencia insuficiente)'}</b></li>
              </ul>

              {plan.keywordDecisions.length > 0 && (
                <>
                  <div className="section" style={{ marginTop: 14 }}>Estrategia de términos</div>
                  <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {plan.keywordDecisions.map((d, i) => <li key={i}><b>{d.action}</b> · {d.categoria} — {d.reason} {d.examples.length > 0 ? <span className="muted">({d.examples.slice(0, 3).join(', ')})</span> : null}</li>)}
                  </ul>
                </>
              )}

              {camp && (
                <>
                  <div className="section" style={{ marginTop: 14 }}>Borrador de campaña — {nombreCanal(camp.channel)}</div>
                  <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    <li><b>{camp.campaignName}</b> · {camp.campaignType} · {clp(camp.budget)}</li>
                    <li>Keywords: {camp.adGroups.reduce((a, g) => a + g.keywords.length, 0)} en {camp.adGroups.length} grupo(s) · Negativas: {camp.negativeKeywords.length}</li>
                    <li>Anuncios: {camp.ads.length} · Destino: {camp.finalDestination}</li>
                  </ul>
                </>
              )}

              <div className="section" style={{ marginTop: 14 }}>Reglas de detención <span className="hint">preautorizadas · con umbral</span></div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {plan.stopCriteria.map((s) => <li key={s.id}>{s.enabled ? '' : '(desactivada) '}{s.descripcion}{s.reason ? ` [${s.reason}]` : ''}</li>)}
              </ul>
            </>
          )}

          <Callout tono="info" ico="🔒">
            Sobre de ejecución: <b>{res?.envelopeDraft?.status ?? 'DRAFT'}</b> (sin aprobar). Planificado: {res?.envelopeDraft?.allowedChannelsPlanned?.map(nombreCanal).join(', ') || '—'} · Ejecutable ahora: {res?.envelopeDraft?.executionEligibleChannels?.length ? res.envelopeDraft.executionEligibleChannels.map(nombreCanal).join(', ') : 'ninguno'}. La autorización global y la ejecución real son un paso posterior, tuyo.
          </Callout>
        </div>
      )}
    </div>
  );
}
