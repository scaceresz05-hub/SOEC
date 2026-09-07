'use client';
/**
 * SOEC · DECISIONES — bucle de decisión. MISMA fuente de verdad que "Mi director": /api/medicion/decisiones
 * (derivado del resultado persistido del Director). El titular APRUEBA / RECHAZA / AJUSTA. Semántica segura:
 * aprobar PREPARE no gasta (genera el plan LAUNCH, que exige otra aprobación); rechazar persiste; ajustar
 * supersede y regenera. Ninguna acción de esta pantalla escribe en Google.
 */
import { useCallback, useEffect, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout, EmptyState, clp, type Tono } from './ui';

export interface DecisionRecord {
  decisionId: string; recommendationId: string; experimentId: string; campaignId: string;
  decisionType: string; decisionStatus: string; createdAt: string; evidenceVersion: string; planHash: string;
  requiresHumanApproval: boolean; confidence: string; financialCommitmentClp: number; providerWritesExpected: number;
  title: string; why: string; plan: string[]; historicalCampaignBudgetClp: number | null; historicalSpendClp: number | null;
  source: string; parentDecisionId: string | null; supersedes: string | null;
}
interface HistItem { at: string; tipo: string; decisionId: string; detalle: string; actor: string | null }
interface EstadoDec { ok: boolean; current: DecisionRecord | null; history: HistItem[] }

const CONF_ES: Record<string, string> = { LOW: 'baja', MEDIUM: 'media', HIGH: 'alta' };
const ESTADO_ES: Record<string, { txt: string; tono: Tono }> = {
  PENDING: { txt: 'PENDIENTE', tono: 'warn' }, APPROVED: { txt: 'APROBADA', tono: 'ok' }, REJECTED: { txt: 'RECHAZADA', tono: 'mut' },
  ADJUSTMENT_REQUESTED: { txt: 'AJUSTE SOLICITADO', tono: 'info' }, SUPERSEDED: { txt: 'REEMPLAZADA', tono: 'mut' }, EXECUTED: { txt: 'EJECUTADA', tono: 'ok' }, FAILED: { txt: 'FALLIDA', tono: 'warn' },
};
/** Qué autoriza APROBAR esta decisión, en lenguaje llano. PREPARE nunca gasta. */
function queHace(d: DecisionRecord): string {
  if (d.decisionType === 'PREPARE_EXPERIMENT_2') return 'Preparará el plan detallado del Experimento 2 (keywords, negativas, CPC, presupuesto propuesto). No se gastará dinero ni se creará ninguna campaña todavía.';
  if (d.decisionType === 'LAUNCH_EXPERIMENT_2') return 'Creará y activará la campaña del Experimento 2 con el presupuesto autorizado. Esta es la única decisión que puede dar lugar a gasto real.';
  return 'Ejecutará la acción propuesta. Revisá el compromiso financiero antes de autorizar.';
}

export function useDecisionVigente(org: string): { estado: EstadoDec | null; recargar: () => void } {
  const [estado, setEstado] = useState<EstadoDec | null>(null);
  const recargar = useCallback(() => {
    if (!org) return;
    (async () => {
      try {
        const r = await fetch('/api/medicion/decisiones', { headers: cabecerasOrg(org), cache: 'no-store' });
        setEstado((await r.json()) as EstadoDec);
      } catch { setEstado({ ok: false, current: null, history: [] }); }
    })();
  }, [org]);
  useEffect(() => { recargar(); }, [recargar]);
  return { estado, recargar };
}

export function Decisiones({ org }: { org: string }): React.ReactElement {
  const { estado, recargar } = useDecisionVigente(org);
  const [modo, setModo] = useState<null | 'aprobar' | 'rechazar' | 'ajustar'>(null);
  const [razon, setRazon] = useState('');
  const [aj, setAj] = useState<{ budget: string; maxCpc: string; geo: string; note: string }>({ budget: '', maxCpc: '', geo: '', note: '' });
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const d = estado?.current ?? null;
  const reset = (): void => { setModo(null); setRazon(''); setAj({ budget: '', maxCpc: '', geo: '', note: '' }); };

  async function accionar(url: string, body: Record<string, unknown>, exito: string): Promise<void> {
    if (!d) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { ...cabecerasOrg(org), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (j.ok) { setMsg(exito); reset(); recargar(); }
      else setMsg(j.error === 'HASH_DESACTUALIZADO' ? 'La propuesta cambió; recargá y revisá la versión vigente.' : j.error === 'YA_RESUELTA' ? 'Esta decisión ya fue resuelta.' : 'No se pudo completar la acción.');
    } catch { setMsg('No se pudo conectar. Reintentá.'); }
    finally { setEnviando(false); }
  }

  if (!estado) return <div className="empty"><div className="et">Cargando decisiones…</div></div>;

  return (
    <div className="live">
      <div className="section">Necesita tu decisión</div>
      {msg && <Callout tono="info" ico="ℹ">{msg}</Callout>}

      {!d ? (
        <EmptyState ico="✓" titulo="No necesitas decidir nada ahora" detalle="SOEC está observando. Cuando haya una decisión real que aprobar, aparecerá acá con su porqué, su costo y su riesgo, y botones para autorizar, rechazar o ajustar. Nada se gasta sin tu confirmación." />
      ) : (
        <div className="decisioncard" style={{ borderLeft: '4px solid var(--warn)' }}>
          <div className="spread">
            <h3 style={{ margin: 0 }}>{d.title}</h3>
            <Badge tono={ESTADO_ES[d.decisionStatus]?.tono ?? 'info'}>{ESTADO_ES[d.decisionStatus]?.txt ?? d.decisionStatus}</Badge>
          </div>
          <p className="s muted" style={{ marginTop: 4 }}>Confianza: <b>{CONF_ES[d.confidence] ?? d.confidence}</b></p>

          <p className="dwhy" style={{ marginTop: 8 }}><b>¿Por qué?</b> {d.why}</p>
          {d.plan.length > 0 && (
            <ul className="s" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{d.plan.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <p className="s" style={{ margin: 0 }}><b>¿Qué hará SOEC si apruebas?</b> {queHace(d)}</p>
            <p className="s" style={{ margin: '8px 0 0' }}>Nuevo compromiso financiero en esta decisión: <b>{clp(d.financialCommitmentClp)}</b> · Escrituras a Google al aprobar: <b>{d.providerWritesExpected}</b></p>
            {(d.historicalCampaignBudgetClp != null || d.historicalSpendClp != null) && (
              <p className="s muted" style={{ margin: '6px 0 0' }}>Contexto histórico (no es compromiso nuevo): presupuesto del experimento anterior {clp(d.historicalCampaignBudgetClp)} · ya gastado {clp(d.historicalSpendClp)}.</p>
            )}
          </div>

          {/* Acciones */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={enviando} onClick={() => { setModo('aprobar'); setMsg(null); }}>Aprobar</button>
            <button type="button" className="btn" disabled={enviando} onClick={() => { setModo('rechazar'); setMsg(null); }}>Rechazar</button>
            <button type="button" className="btn" disabled={enviando} onClick={() => { setModo('ajustar'); setMsg(null); }}>Ajustar</button>
          </div>

          {modo === 'aprobar' && (
            <div className="card" style={{ marginTop: 10, borderLeft: '3px solid var(--ok)' }}>
              <p className="s" style={{ margin: 0 }}>Vas a aprobar: <b>{d.title}</b>.</p>
              <p className="s" style={{ margin: '6px 0 0' }}>{queHace(d)}</p>
              <p className="s muted" style={{ margin: '6px 0 0' }}>Compromiso financiero de esta aprobación: <b>{clp(d.financialCommitmentClp)}</b>.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn primary" disabled={enviando} onClick={() => accionar('/api/medicion/decisiones/aprobar', { decisionId: d.decisionId, planHash: d.planHash }, 'Decisión aprobada. SOEC preparó el siguiente paso.')}>Confirmar aprobación</button>
                <button type="button" className="btn" disabled={enviando} onClick={reset}>Cancelar</button>
              </div>
            </div>
          )}
          {modo === 'rechazar' && (
            <div className="card" style={{ marginTop: 10 }}>
              <label className="s" htmlFor="dec-razon">Motivo (opcional)</label>
              <textarea id="dec-razon" className="field" rows={2} value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Por qué no ahora…" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn primary" disabled={enviando} onClick={() => accionar('/api/medicion/decisiones/rechazar', { decisionId: d.decisionId, reason: razon || undefined }, 'Decisión rechazada. SOEC no la volverá a proponer sin evidencia nueva.')}>Confirmar rechazo</button>
                <button type="button" className="btn" disabled={enviando} onClick={reset}>Cancelar</button>
              </div>
            </div>
          )}
          {modo === 'ajustar' && (
            <div className="card" style={{ marginTop: 10 }}>
              <p className="s muted" style={{ marginTop: 0 }}>Indicá qué querés cambiar. SOEC generará una propuesta nueva que vuelve a requerir tu aprobación (ningún ajuste gasta por sí solo).</p>
              <div className="grid g-2" style={{ gap: 8 }}>
                <div><label className="s" htmlFor="aj-b">Presupuesto nuevo (CLP)</label><input id="aj-b" className="field" inputMode="numeric" value={aj.budget} onChange={(e) => setAj({ ...aj, budget: e.target.value })} placeholder="p.ej. 9000" /></div>
                <div><label className="s" htmlFor="aj-c">Tope de CPC (CLP)</label><input id="aj-c" className="field" inputMode="numeric" value={aj.maxCpc} onChange={(e) => setAj({ ...aj, maxCpc: e.target.value })} placeholder="p.ej. 700" /></div>
                <div><label className="s" htmlFor="aj-g">Geografía</label><input id="aj-g" className="field" value={aj.geo} onChange={(e) => setAj({ ...aj, geo: e.target.value })} placeholder="p.ej. Región Metropolitana" /></div>
                <div><label className="s" htmlFor="aj-n">Nota</label><input id="aj-n" className="field" value={aj.note} onChange={(e) => setAj({ ...aj, note: e.target.value })} placeholder="contexto para SOEC" /></div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn primary" disabled={enviando} onClick={() => {
                  const changes: Record<string, unknown> = {};
                  const b = Number(aj.budget); const c = Number(aj.maxCpc);
                  if (aj.budget && !Number.isNaN(b)) changes['budget'] = b;
                  if (aj.maxCpc && !Number.isNaN(c)) changes['maxCpc'] = c;
                  if (aj.geo.trim()) changes['geo'] = aj.geo.trim();
                  void accionar('/api/medicion/decisiones/ajustar', { decisionId: d.decisionId, changes, note: aj.note || undefined }, 'Ajuste registrado. SOEC generó una propuesta nueva para tu aprobación.');
                }}>Enviar ajuste</button>
                <button type="button" className="btn" disabled={enviando} onClick={reset}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Historial real (no un texto fijo). */}
      <div className="section" style={{ marginTop: 18 }}>Historial</div>
      {(estado.history?.length ?? 0) === 0 ? (
        <div className="card"><p className="s muted" style={{ margin: 0 }}>Aún no hay decisiones registradas. Cuando apruebes, rechaces o ajustes, quedará acá con su fecha.</p></div>
      ) : (
        <div className="card">
          <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
            {[...estado.history].reverse().map((h, i) => (
              <li key={i}>{new Date(h.at).toLocaleString('es-CL')} · <b>{ESTADO_ES[h.tipo]?.txt ?? h.tipo}</b>{h.detalle ? ` — ${h.detalle}` : ''}{h.actor && h.actor !== 'SOEC' ? ` (${h.actor})` : ''}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
