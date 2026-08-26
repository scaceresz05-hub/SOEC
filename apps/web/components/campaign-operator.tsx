'use client';

/**
 * OPERADOR DE CAMPAÑA (SIMULACIÓN / DRY-RUN). Muestra por SEPARADO tres estados —ESTRATEGIA, BORRADOR DE
 * CAMPAÑA y EJECUCIÓN— y el detalle publicable del draft (keywords activas, observadas sin gasto, negativas,
 * copy y destino validado). SIN gastar ni escribir nada. La ejecución real controlada es un paso posterior.
 */
import { useCallback, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout } from './ui';
import { AutorizacionSobre } from './autorizacion-sobre';

interface AsignacionCanal { canal: string; presupuesto: number; motivo: string }
interface StopRule { id: string; descripcion: string; enabled: boolean; reason?: string }
interface ActiveKeyword { text: string; intentClassification: string; confidence: string; action: string; matchType: string }
interface AdGroup { name: string; intent: string; action: string; keywords: ActiveKeyword[]; ads: { headlines: string[]; descriptions: string[] }[]; finalDestination: string; destinationRationale: string }
interface Campaign { channel: string; campaignName: string; campaignType: string; budget: number; adGroups: AdGroup[]; negativeKeywords: { text: string; matchType: string; rationale: string }[] }
interface Hypothesis { id: string; category: string; statement: string; evidenceStrength: string }
interface Completeness { status: string; pendingCopyCount: number; pendingDestination: boolean; unknownActiveKeywords: number; issues: string[] }
interface MarketingPlan {
  objective: string; totalAuthorizedBudget: number;
  strategyStatus: string; campaignDraftStatus: string; executionStatus: string; campaignCompleteness: Completeness;
  channelExecutionAvailability: { canal: string; canExecute: boolean; executionGate: string }[];
  recommendedChannelMix: AsignacionCanal[]; spendRecommendation: string;
  selectedHypothesis: Hypothesis | null; backlogHypotheses: Hypothesis[];
  activeKeywords: ActiveKeyword[]; observeNoSpendKeywords: { text: string; intentClassification: string }[];
  maxSpendWithoutContact: { value: number; rationale: string }; targetCpa: { kind: string; value?: number };
  stopCriteria: StopRule[]; campaigns: Campaign[]; readinessSummary: string;
}
interface Resultado { plan: MarketingPlan | null; envelopeDraft: { status: string; executionEligibleChannels: string[]; allowedChannelsPlanned: string[] } | null }

const clp = (n: number): string => `$${Math.round(n).toLocaleString('es-CL')}`;
const nombreCanal = (c: string): string => (c === 'google' ? 'Google Ads' : c === 'meta' ? 'Meta Ads' : c);
const gateHumano: Record<string, string> = { READY: 'lista', ADVERTISER_VERIFICATION_PENDING: 'Google verifica al anunciante', OAUTH_REQUIRED: 'falta conectar la cuenta', ACCOUNT_PAUSED: 'cuenta pausada', PROVIDER_NOT_CONNECTED: 'no conectado', PROVIDER_POLICY_BLOCKED: 'bloqueada por política', UNKNOWN: 'desconocido' };
const badge = (ok: boolean, listo: string, pend: string): { tono: 'ok' | 'warn'; txt: string } => (ok ? { tono: 'ok', txt: listo } : { tono: 'warn', txt: pend });

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
      const r = await fetch('/api/medicion/campaign-operator-plan', { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: JSON.stringify({ objetivo, presupuestoTotal: presupuesto, periodoDias: dias }) });
      const j = (await r.json().catch(() => ({}))) as Resultado & { error?: string };
      if (!r.ok || j.error) { setError('No se pudo generar el plan. Probá de nuevo.'); return; }
      setRes(j);
    } catch { setError('No se pudo contactar el servicio.'); } finally { setCargando(false); }
  }, [org, objetivo, presupuesto, dias]);

  const plan = res?.plan;
  const gExec = plan?.channelExecutionAvailability.find((c) => c.canal === 'google');
  const camp = plan?.campaigns[0];
  const bS = plan && badge(plan.strategyStatus === 'READY', 'Lista', 'Diagnóstico requerido');
  const bC = plan && badge(plan.campaignDraftStatus === 'READY_FOR_APPROVAL', 'Lista para aprobación', 'Incompleta');
  const bE = plan && badge(plan.executionStatus === 'READY', 'Habilitada', 'Bloqueada');

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="spread"><div className="section" style={{ margin: 0 }}>Preparar experimento de campaña <span className="hint">simulación · no gasta dinero</span></div><Badge tono="info">DRY-RUN</Badge></div>
      <div className="grid g-3" style={{ marginTop: 12 }}>
        <label className="s">Objetivo<input className="field" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} /></label>
        <label className="s">Presupuesto total (CLP)<input className="field" type="number" min={0} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value))} /></label>
        <label className="s">Período (días)<input className="field" type="number" min={1} value={dias} onChange={(e) => setDias(Number(e.target.value))} /></label>
      </div>
      <div style={{ marginTop: 12 }}><button type="button" className="btn primary" disabled={cargando} onClick={() => void simular()}>{cargando ? 'Preparando…' : 'Simular plan (sin gastar)'}</button></div>
      {error && <Callout tono="warn" ico="⚠">{error}</Callout>}

      {plan && (
        <div style={{ marginTop: 16 }}>
          <div className="grid g-3">
            <div className="card"><div className="spread"><b>ESTRATEGIA</b><Badge tono={bS!.tono}>{bS!.txt}</Badge></div></div>
            <div className="card"><div className="spread"><b>CAMPAÑA</b><Badge tono={bC!.tono}>{bC!.txt}</Badge></div></div>
            <div className="card"><div className="spread"><b>EJECUCIÓN</b><Badge tono={bE!.tono}>{bE!.txt}</Badge></div></div>
          </div>
          <p className="s" style={{ marginTop: 8 }}>{gExec && !gExec.canExecute ? `Google Ads: ${gateHumano[gExec.executionGate] ?? gExec.executionGate}. El gate externo no impide terminar el borrador.` : ''} SOEC no ejecuta ni gasta nada.</p>

          {plan.strategyStatus === 'DIAGNOSIS_REQUIRED' ? (
            <Callout tono="warn" ico="🔍">Registrar el resultado del diagnóstico del funnel antes de crear campañas. {plan.readinessSummary}</Callout>
          ) : (
            <>
              {plan.campaignCompleteness.issues.length > 0 && (
                <Callout tono="warn" ico="⚠">Borrador incompleto: {plan.campaignCompleteness.issues.join(' · ')}</Callout>
              )}
              {plan.selectedHypothesis && (
                <>
                  <div className="section" style={{ marginTop: 14 }}>Hipótesis a probar <span className="hint">una primaria · evidencia {plan.selectedHypothesis.evidenceStrength}</span></div>
                  <p className="s" style={{ margin: '4px 0 0' }}>{plan.selectedHypothesis.statement}</p>
                </>
              )}
              <div className="section" style={{ marginTop: 14 }}>Presupuesto del experimento <span className="hint">tope autorizado {clp(plan.totalAuthorizedBudget)}</span></div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {plan.recommendedChannelMix.map((m) => <li key={m.canal}><b>{nombreCanal(m.canal)}:</b> {clp(m.presupuesto)} — {m.motivo}</li>)}
                <li>Corte por gasto sin contacto: <b>{clp(plan.maxSpendWithoutContact.value)}</b> · CPA objetivo: <b>{plan.targetCpa.kind === 'VALUE' ? clp(plan.targetCpa.value ?? 0) : 'sin definir (evidencia insuficiente)'}</b></li>
              </ul>

              {camp && (
                <>
                  <div className="section" style={{ marginTop: 14 }}>Borrador de campaña — {nombreCanal(camp.channel)} · {camp.campaignType} · {clp(camp.budget)}</div>
                  {camp.adGroups.map((g, gi) => (
                    <div key={gi} className="card" style={{ marginTop: 8 }}>
                      <div className="spread"><b>{g.name}</b><Badge tono="info">{g.action}</Badge></div>
                      <p className="s" style={{ margin: '4px 0 0' }}>Keywords: {g.keywords.map((k) => `${k.text} [${k.matchType}]`).join(' · ')}</p>
                      <p className="s muted" style={{ margin: '2px 0 0' }}>Titulares: {g.ads[0]?.headlines.join(' · ')}</p>
                      <p className="s muted" style={{ margin: '2px 0 0' }}>Destino: {g.finalDestination} — {g.destinationRationale}</p>
                    </div>
                  ))}
                  <p className="s" style={{ marginTop: 8 }}><b>Negativas:</b> {camp.negativeKeywords.map((n) => `${n.text} [${n.matchType}]`).join(' · ') || '—'}</p>
                  {plan.observeNoSpendKeywords.length > 0 && <p className="s muted" style={{ margin: '2px 0 0' }}><b>Observadas sin gasto</b> (evidencia, no reciben inversión): {plan.observeNoSpendKeywords.map((k) => k.text).join(' · ')}</p>}
                </>
              )}

              <div className="section" style={{ marginTop: 14 }}>Reglas de detención <span className="hint">umbrales ejecutables</span></div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.stopCriteria.map((s) => <li key={s.id}>{s.enabled ? '' : '(desactivada) '}{s.descripcion}{s.reason ? ` [${s.reason}]` : ''}</li>)}</ul>

              {plan.campaignDraftStatus === 'READY_FOR_APPROVAL' && <AutorizacionSobre org={org} />}
            </>
          )}

        </div>
      )}
    </div>
  );
}
