'use client';

/**
 * OPERADOR DE CAMPAÑA (SIMULACIÓN / DRY-RUN). El humano ingresa OBJETIVO + PRESUPUESTO TOTAL + PERÍODO y SOEC
 * produce un plan estructurado (mezcla de canales, borradores, criterios de éxito/detención) + un borrador de
 * sobre de ejecución — SIN gastar ni escribir nada. La ejecución real controlada es un paso posterior.
 */
import { useCallback, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout } from './ui';

interface AsignacionCanal { canal: string; disponible: boolean; presupuesto: number; motivo: string }
interface StopRule { id: string; tipo: string; descripcion: string }
interface MarketingPlan {
  objective: string; totalAuthorizedBudget: number; currency: string;
  period: { dias: number; startAt: string | null; endAt: string | null };
  recommendedChannelMix: AsignacionCanal[]; totalSpendRecommended: number; spendRecommendation: string;
  status: 'DIAGNOSIS_REQUIRED' | 'READY_FOR_AUTHORIZATION'; auditFunnel: string;
  campaigns: { canal: string; campaignName: string; budget: number }[];
  reasoning: { facts: string[]; hypotheses: string[] };
  successCriteria: string[]; stopCriteria: StopRule[]; requiredTracking: string[]; landingIssues: string[]; risks: string[];
}
interface Resultado { modo: string; autonomousReal: boolean; plan: MarketingPlan | null; envelopeDraft: { status: string } | null }

const clp = (n: number): string => `$${Math.round(n).toLocaleString('es-CL')}`;

export function CampaignOperator({ org }: { org: string | null | undefined }): React.ReactElement {
  const [objetivo, setObjetivo] = useState('Conseguir clínicas interesadas en SmileFlow');
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
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
        body: JSON.stringify({ objetivo, presupuestoTotal: presupuesto, periodoDias: dias }),
      });
      const j = (await r.json().catch(() => ({}))) as Resultado & { error?: string };
      if (!r.ok || j.error) { setError('No se pudo generar el plan. Probá de nuevo.'); return; }
      setRes(j);
    } catch {
      setError('No se pudo contactar el servicio.');
    } finally {
      setCargando(false);
    }
  }, [org, objetivo, presupuesto, dias]);

  const plan = res?.plan;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="spread">
        <div className="section" style={{ margin: 0 }}>Preparar experimento de campaña <span className="hint">simulación · no gasta dinero</span></div>
        <Badge tono="info">DRY-RUN</Badge>
      </div>
      <div className="grid g-3" style={{ marginTop: 12 }}>
        <label className="s">Objetivo
          <input className="field" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} />
        </label>
        <label className="s">Presupuesto total (CLP)
          <input className="field" type="number" min={0} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value))} />
        </label>
        <label className="s">Período (días)
          <input className="field" type="number" min={1} value={dias} onChange={(e) => setDias(Number(e.target.value))} />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={cargando} onClick={() => void simular()}>
          {cargando ? 'Preparando…' : 'Simular plan (sin gastar)'}
        </button>
      </div>
      {error && <Callout tono="warn" ico="⚠">{error}</Callout>}

      {plan && (
        <div style={{ marginTop: 16 }}>
          <div className="spread">
            <h3 style={{ margin: 0 }}>{plan.objective}</h3>
            <Badge tono={plan.status === 'DIAGNOSIS_REQUIRED' ? 'warn' : 'ok'}>
              {plan.status === 'DIAGNOSIS_REQUIRED' ? 'Diagnóstico requerido' : 'Listo para autorizar'}
            </Badge>
          </div>
          <p className="lede" style={{ marginTop: 8 }}>
            {plan.status === 'DIAGNOSIS_REQUIRED'
              ? `Recomendación de gasto: ${plan.spendRecommendation}. Primero auditar el funnel; no invertir todavía.`
              : plan.spendRecommendation}
          </p>

          <div className="section" style={{ marginTop: 12 }}>Mezcla de canales <span className="hint">tope autorizado {clp(plan.totalAuthorizedBudget)}</span></div>
          <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {plan.recommendedChannelMix.map((m) => (
              <li key={m.canal}><b>{m.canal === 'google' ? 'Google Ads' : 'Meta Ads'}:</b> {clp(m.presupuesto)} — {m.motivo}</li>
            ))}
          </ul>

          <div className="section" style={{ marginTop: 12 }}>Hechos</div>
          <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.reasoning.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
          {plan.reasoning.hypotheses.length > 0 && (
            <>
              <div className="section" style={{ marginTop: 12 }}>Hipótesis <span className="hint">no confirmadas</span></div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.reasoning.hypotheses.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </>
          )}

          <div className="section" style={{ marginTop: 12 }}>Criterio de éxito</div>
          <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.successCriteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <div className="section" style={{ marginTop: 12 }}>Reglas de detención <span className="hint">preautorizadas en el sobre</span></div>
          <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.stopCriteria.map((s) => <li key={s.id}>{s.descripcion}</li>)}</ul>

          {plan.campaigns.length > 0 && (
            <>
              <div className="section" style={{ marginTop: 12 }}>Borradores de campaña</div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {plan.campaigns.map((c, i) => <li key={i}><b>{c.canal === 'google' ? 'Google Ads' : 'Meta Ads'}:</b> {c.campaignName} — {clp(c.budget)}</li>)}
              </ul>
            </>
          )}

          <Callout tono="info" ico="🔒">
            Sobre de ejecución: <b>{res?.envelopeDraft?.status ?? 'DRAFT'}</b> (sin aprobar). SOEC no ejecuta ni gasta nada:
            la autorización global y la ejecución real controlada son un paso posterior, tuyo.
          </Callout>
        </div>
      )}
    </div>
  );
}
