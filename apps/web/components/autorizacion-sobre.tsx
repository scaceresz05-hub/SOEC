'use client';

/**
 * AUTORIZACIÓN DE EJECUCIÓN — soberanía financiera humana. Muestra el sobre (tope TOTAL, experimento, máximo
 * gasto sin contacto, período, canal, stop rules, hash del plan) y el botón para AUTORIZAR. La autorización es
 * una acción HUMANA (financiera): SOEC/Chrome no la pulsan. Nada se ejecuta: los flags de ejecución están en false.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout } from './ui';

interface Envelope {
  id: string; planId: string; status: string; objective: string; currency: string;
  totalCap: number; experimentBudget: number; maxSpendWithoutContact: number;
  authorizedDurationDays: number;
  startsAt: string | null; expiresAt: string | null;
  plannedChannels: string[]; authorizedChannels: string[]; authorizedActionTypes: string[];
  stopRules: { id: string; tipo?: string; enabled: boolean; threshold?: number | null; date?: string | null; condition?: string; reason?: string }[];
  planVersion: string; planHash: string; approvedBy: string | null; approvedAt: string | null;
}
interface Financial { historicalSpend: number; envelopeSpend: number; committedSpend: number; remainingCap: number }
interface Resp { envelope: Envelope | null; financial: Financial; executionAllowed: { decision: string; reasonCode: string | null }; autonomousReal: boolean; supervisedReal: boolean }
interface IntentDetalle { id: string; actionType: string; materialEntityFingerprint: string; idempotencyKey: string; status: string; validation: { decision: string; reasonCode: string | null }; parent: { materialFingerprint: string; logicalName?: string } | null; materialBinding: { approved: boolean }; financialImpact: { scope: string; projectedCommitment: number }; providerPayload: { operation?: string } | null }
interface ExecPlan { shadowPlanCreated: boolean; mode?: string; summary?: { executionActionCount: number; byType: Record<string, number>; entitiesAffected: number } | null; realExecutionDecision?: string; realExecutionReason?: string | null; providerMutateCalls?: number; providerBindings?: { count: number; fabricatedIds: number }; intents?: IntentDetalle[]; envelopeCompatibility?: { compatible: boolean; reasonCode: string | null } }

const clp = (n: number): string => `$${Math.round(n).toLocaleString('es-CL')}`;
const nombreCanal = (c: string): string => (c === 'google' ? 'Google Ads' : c === 'meta' ? 'Meta Ads' : c);
/** Texto material de una stop rule (valores completos, no sólo el tipo). */
function stopTxt(s: { id: string; enabled: boolean; threshold?: number | null; date?: string | null; condition?: string; reason?: string }): string {
  if (!s.enabled) return `DESACTIVADO${s.reason ? ` (${s.reason})` : ''}`;
  if (s.id === 'STOP_BUDGET') return clp(s.threshold ?? 0);
  if (s.id === 'STOP_ZERO_CONVERSION') return `${clp(s.threshold ?? 0)} sin contacto`;
  if (s.id === 'STOP_CPA') return s.threshold != null ? `CPA > ${clp(s.threshold)}` : 'DESACTIVADO';
  if (s.id === 'STOP_PERIOD') return s.date ? `hasta ${s.date.slice(0, 10)}` : 'al terminar la duración autorizada (desde la activación)';
  return s.condition ?? '—';
}
const ESTADO: Record<string, { txt: string; tono: 'ok' | 'warn' | 'info' }> = {
  DRAFT: { txt: 'Borrador', tono: 'info' }, READY_FOR_HUMAN_APPROVAL: { txt: 'Lista para tu autorización', tono: 'warn' },
  APPROVED_WAITING_EXTERNAL_GATE: { txt: 'Autorizada · esperando a Google', tono: 'ok' }, APPROVED_READY_TO_ACTIVATE: { txt: 'Autorizada · lista para activar', tono: 'ok' },
  ACTIVE: { txt: 'Activa', tono: 'ok' }, PAUSED_BY_GUARDRAIL: { txt: 'Pausada por guardrail', tono: 'warn' }, STOPPED: { txt: 'Detenida', tono: 'warn' },
  REVOKED: { txt: 'Revocada', tono: 'warn' }, EXPIRED: { txt: 'Expirada', tono: 'warn' }, SUPERSEDED: { txt: 'Reemplazada por nueva revisión', tono: 'info' }, FAILED_SAFE: { txt: 'Detenida de forma segura', tono: 'warn' },
};

export function AutorizacionSobre({ org, nonce = 0 }: { org: string | null | undefined; nonce?: number }): React.ReactElement {
  const [resp, setResp] = useState<Resp | null>(null);
  const [exec, setExec] = useState<ExecPlan | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ejecución del plan autorizado (trigger HUMANO). `confirmando` = diálogo abierto; `ejecEnviada` = ya se disparó
  // el POST (se deshabilita permanentemente, sin auto-retry ni re-habilitación); `ejecMsg` = resultado mostrado.
  const [confirmando, setConfirmando] = useState(false);
  const [ejecEnviada, setEjecEnviada] = useState(false);
  const [ejecMsg, setEjecMsg] = useState<string | null>(null);
  const enviadoRef = useRef(false); // guard SÍNCRONO anti doble-submit (el estado no se actualiza dentro del mismo tick)

  // HIDRATACIÓN read-only: al montar / cambiar de tenant / re-simular, se lee el envelope PERSISTIDO (GET) y el
  // PLAN DE EJECUCIÓN en SHADOW (GET). Ninguna escritura ni acción de proveedor.
  const cargar = useCallback(async () => {
    if (!org) { setCargandoInicial(false); return; }
    setError(null);
    try {
      const r = await fetch('/api/medicion/envelope', { headers: cabecerasOrg(org), cache: 'no-store' });
      if (!r.ok) { setError('No pudimos leer el estado del sobre.'); return; }
      setResp((await r.json()) as Resp);
      const e = await fetch('/api/medicion/execution-plan?detail=intents', { headers: cabecerasOrg(org), cache: 'no-store' });
      if (e.ok) setExec((await e.json()) as ExecPlan);
    } catch { setError('No pudimos contactar el servicio.'); }
    finally { setCargandoInicial(false); }
  }, [org]);
  // Reset al cambiar de org/nonce (tenant scoping): limpia el envelope anterior ANTES de cargar el nuevo.
  useEffect(() => { setResp(null); setError(null); setCargandoInicial(true); void cargar(); }, [cargar, nonce]);

  const accion = useCallback(async (ruta: string) => {
    if (!org) return;
    setCargando(true); setError(null);
    try {
      const r = await fetch(`/api/medicion/${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}' });
      if (!r.ok) { setError('No se pudo completar la acción.'); return; }
      await cargar();
    } catch { setError('No se pudo contactar el servicio.'); } finally { setCargando(false); }
  }, [org, cargar]);

  // TRIGGER HUMANO del plan autorizado: usa el entry point EXISTENTE POST /api/medicion/canary-execute (el
  // contexto canónico org/envelope/planHash/scope lo fija y valida el BACKEND; la UI no envía valores editables).
  // Un solo disparo: al enviar se deshabilita para siempre; nunca reintenta ni re-habilita. Sin lógica financiera
  // en el frontend: la autoridad (gates/reserva/idempotencia/provider) vive en el executor Phase2B.
  const ejecutarPlan = useCallback(async () => {
    if (!org || enviadoRef.current) return; // guard síncrono: un solo POST aunque haya doble click en el mismo tick
    enviadoRef.current = true;
    setEjecEnviada(true); // anti doble-submit inmediato
    setConfirmando(false);
    setEjecMsg('Ejecución enviada. No volver a ejecutar.');
    try {
      const r = await fetch('/api/medicion/canary-execute', { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: '{}' });
      if (!r.ok) { setEjecMsg('Resultado ambiguo. NO REINTENTAR. Verificar estado.'); return; }
      const j = (await r.json()) as { decision?: string; reason?: string | null; providerMutateCalls?: number };
      if (j.decision === 'DENY') setEjecMsg(`Ejecución no realizada (${j.reason ?? 'bloqueada'}). Sin gasto. No reintentar.`);
      else if (j.decision === 'EXECUTED') setEjecMsg(`Ejecución enviada · acciones al proveedor: ${j.providerMutateCalls ?? '—'}. No volver a ejecutar.`);
      else setEjecMsg('Resultado ambiguo. NO REINTENTAR. Verificar estado.');
    } catch {
      setEjecMsg('Resultado ambiguo. NO REINTENTAR. Verificar estado.');
    }
  }, [org]);

  const env = resp?.envelope;
  const st = env ? (ESTADO[env.status] ?? { txt: env.status, tono: 'info' as const }) : null;
  const aprobado = env ? ['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'ACTIVE'].includes(env.status) : false;
  // FAIL-CLOSED de UI: un envelope del schema ANTERIOR (incompatible con CAMPAIGN_TOTAL) NO puede presentar
  // consentimiento financiero ni habilitar la autorización. Se detecta por el execution-plan (envelopeCompatibility)
  // o, aún antes de cargarlo, por la ausencia del campo material `authorizedDurationDays`.
  const compat = exec?.envelopeCompatibility;
  const incompatible = !!env && (compat ? compat.compatible === false : typeof env.authorizedDurationDays !== 'number');

  return (
    <div className="card" style={{ marginTop: 12, borderLeft: '4px solid var(--line-strong, #cbd5e1)' }}>
      <div className="spread"><div className="section" style={{ margin: 0 }}>Autorización de ejecución <span className="hint">soberanía financiera · la autorizás vos</span></div>{st && <Badge tono={st.tono}>{st.txt}</Badge>}</div>

      {cargandoInicial && <p className="s muted" style={{ marginTop: 10 }}>Cargando el estado del sobre…</p>}

      {/* Fail-safe: si el GET falla, NO se asume "no hay sobre" ni se crea uno. */}
      {!cargandoInicial && error && !env && <Callout tono="warn" ico="⚠">{error} Recargá la página para reintentar.</Callout>}

      {!cargandoInicial && !error && !env && (
        <div style={{ marginTop: 10 }}>
          <p className="s">Cuando el borrador está listo, podés preparar el sobre de ejecución para revisarlo y autorizarlo.</p>
          <button type="button" className="btn" disabled={cargando} onClick={() => void accion('envelope')}>{cargando ? 'Preparando…' : 'Preparar sobre de ejecución'}</button>
        </div>
      )}

      {/* FAIL-CLOSED: envelope del schema anterior ⇒ no se presenta CAMPAIGN_TOTAL/duración/9 acciones ni botón. */}
      {!cargandoInicial && env && incompatible && (
        <div style={{ marginTop: 10 }}>
          <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Sobre / Plan:</b> <code>{env.id}</code></li>
          </ul>
          <Callout tono="warn" ico="⚠">Este plan requiere actualización antes de poder autorizarse. Volvé a generar el plan para producir la revisión vigente; el sobre anterior no puede autorizarse.</Callout>
        </div>
      )}

      {!cargandoInicial && env && !incompatible && (
        <div style={{ marginTop: 10 }}>
          <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Objetivo:</b> {env.objective}</li>
            <li><b>Sobre / Plan:</b> <code>{env.id}</code> · <code>{env.planId}</code></li>
            <li style={{ marginTop: 4 }}><b>TOPE GLOBAL DEL SOBRE:</b> {clp(env.totalCap)} <span className="muted">(máximo absoluto — STOP_BUDGET)</span></li>
            <li><b>PRESUPUESTO TOTAL DEL EXPERIMENTO (Google):</b> {clp(env.experimentBudget)} <span className="muted">(tope total de la campaña, distinto del tope global)</span></li>
            <li><b>TIPO DE PRESUPUESTO GOOGLE:</b> TOTAL DE CAMPAÑA <span className="muted">(CUSTOM_PERIOD — no es un presupuesto diario)</span></li>
            <li><b>CORTE SI NO HAY CONTACTOS:</b> {clp(env.maxSpendWithoutContact)}</li>
            <li style={{ marginTop: 4 }}><b>Duración:</b> {env.authorizedDurationDays} días desde la activación{env.startsAt && env.expiresAt ? <span className="muted"> · ventana {env.startsAt.slice(0, 10)} → {env.expiresAt.slice(0, 10)}</span> : <span className="muted"> · la ventana se fija al activar</span>}</li>
            <li><b>Canal(es):</b> {env.plannedChannels.map(nombreCanal).join(', ') || '—'}</li>
            <li><b>Acciones autorizadas:</b> {env.authorizedActionTypes.join(', ')}</li>
            <li><b>Reglas de detención:</b>
              <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                {env.stopRules.map((s) => <li key={s.id}>{s.id}: {stopTxt(s)}</li>)}
              </ul>
            </li>
            <li><b>Plan (versión/hash):</b> <code>{env.planVersion}</code></li>
          </ul>

          {resp && (
            <>
              <div className="grid g-4" style={{ marginTop: 8 }}>
                <div className="s"><span className="muted">Gasto histórico (no cuenta)</span><br /><b>{clp(resp.financial.historicalSpend)}</b></div>
                <div className="s"><span className="muted">Gasto del sobre</span><br /><b>{clp(resp.financial.envelopeSpend)}</b></div>
                <div className="s"><span className="muted">Comprometido</span><br /><b>{clp(resp.financial.committedSpend)}</b></div>
                <div className="s"><span className="muted">Cap restante</span><br /><b>{clp(resp.financial.remainingCap)}</b></div>
              </div>
              <p className="s muted" style={{ marginTop: 8 }}>Ejecución real: <b>{resp.executionAllowed.decision === 'ALLOW' ? 'permitida' : 'bloqueada'}</b>{resp.executionAllowed.reasonCode ? ` (${resp.executionAllowed.reasonCode})` : ''} · supervisedReal={String(resp.supervisedReal)} · autonomousReal={String(resp.autonomousReal)}. SOEC no ejecuta ni gasta nada todavía.</p>
            </>
          )}

          {exec?.shadowPlanCreated && exec.summary && (
            <div style={{ marginTop: 12 }}>
              <div className="section">Plan de ejecución <span className="hint">SHADOW · sólo lectura · sin escrituras reales</span></div>
              <ul className="s" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                <li><b>Acciones:</b> {exec.summary.executionActionCount} · <b>Entidades:</b> {exec.summary.entitiesAffected} · <b>Proveedor:</b> Google Ads</li>
                <li><b>Por tipo:</b> {Object.entries(exec.summary.byType).map(([t, n]) => `${t}×${n}`).join(' · ')}</li>
                <li><b>Ejecución real:</b> {exec.realExecutionDecision === 'ALLOW' ? 'permitida' : 'bloqueada'}{exec.realExecutionReason ? ` (${exec.realExecutionReason})` : ''} · <b>mutate calls:</b> {exec.providerMutateCalls ?? 0} · <b>bindings:</b> {exec.providerBindings?.count ?? 0} (IDs fabricados: {exec.providerBindings?.fabricatedIds ?? 0})</li>
              </ul>
              {exec.intents && exec.intents.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary className="s" style={{ cursor: 'pointer' }}>Ver detalle de acciones ({exec.intents.length}) · auditable, sin ejecutar</summary>
                  <ul className="s" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {exec.intents.map((it) => (
                      <li key={it.id}>
                        <b>{it.actionType}</b> · fp <code>{it.materialEntityFingerprint.slice(0, 8)}</code>{it.parent ? <> · grupo <b>{it.parent.logicalName ?? it.parent.materialFingerprint.slice(0, 8)}</b></> : null} · ik <code>{it.idempotencyKey.slice(0, 8)}</code> · {it.materialBinding.approved ? 'material aprobado' : 'MATERIAL NO APROBADO'} · {it.status}{it.validation.reasonCode ? ` (${it.validation.reasonCode})` : ''} · {it.financialImpact.scope} ${Math.round(it.financialImpact.projectedCommitment).toLocaleString('es-CL')} · {it.providerPayload?.operation ?? '—'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Callout tono="info" ico="🛰">Plan de ejecución preparado (SHADOW). La ejecución real está bloqueada; SOEC no escribe en Google Ads ni gasta.</Callout>
            </div>
          )}

          {env.status === 'READY_FOR_HUMAN_APPROVAL' && (
            <>
              <Callout tono="warn" ico="✍">
                Autorizo a SOEC a ejecutar un experimento de Google Ads con un <b>presupuesto TOTAL de campaña de {clp(env.experimentBudget)}</b> durante <b>{env.authorizedDurationDays} días desde su activación</b>, dentro de un <b>tope global autorizado de {clp(env.totalCap)}</b>. SOEC <b>no</b> está autorizado a aumentar este presupuesto total sin una nueva revisión y aprobación. SOEC deberá detener el gasto si alcanza <b>{clp(env.maxSpendWithoutContact)}</b> sin obtener un contacto real atribuible, además de las demás reglas de detención mostradas.
              </Callout>
              <button type="button" className="btn primary" disabled={cargando} onClick={() => void accion('envelope-approve')}>{cargando ? 'Autorizando…' : 'AUTORIZAR SOBRE DE EJECUCIÓN'}</button>
            </>
          )}

          {aprobado && (
            <div style={{ marginTop: 8 }}>
              <p className="s">Autorizado por <b>{env.approvedBy}</b> el {env.approvedAt?.slice(0, 10)}. La ejecución real permanece bloqueada por el gate externo y por los interruptores de seguridad.</p>

              {/* TRIGGER HUMANO del plan autorizado. Requiere click humano + confirmación; los agentes no lo pulsan. */}
              <div className="card" style={{ marginTop: 10, borderLeft: '4px solid var(--line-strong, #cbd5e1)' }}>
                <div className="section" style={{ margin: 0 }}>Ejecución del plan autorizado <span className="hint">acción humana · un solo click</span></div>
                <ul className="s" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  <li><b>Sobre:</b> <code>{env.id}</code></li>
                  <li><b>Acciones:</b> {exec?.summary?.executionActionCount ?? 59}</li>
                  <li><b>Compromiso máximo del experimento:</b> {clp(env.experimentBudget)}</li>
                  <li><b>Cap global:</b> {clp(env.totalCap)}</li>
                  <li><b>Google Ads:</b> 860-553-9300 · SmileFlow Clinic</li>
                  <li><b>Presupuesto:</b> Campaign Total Budget · {clp(env.experimentBudget)}</li>
                  <li><b>Duración:</b> {env.authorizedDurationDays} días desde la activación</li>
                </ul>

                {resp && !resp.supervisedReal && (
                  <p className="s" style={{ marginTop: 8 }}><Badge tono="warn">MODO SUPERVISADO DESACTIVADO</Badge> <span className="muted">La ejecución real está deshabilitada por seguridad. Este botón no puede activarla.</span></p>
                )}

                {!ejecEnviada && !confirmando && (
                  <button type="button" className="btn primary" style={{ marginTop: 8 }} disabled={!resp?.supervisedReal} onClick={() => setConfirmando(true)}>EJECUTAR PLAN AUTORIZADO</button>
                )}

                {confirmando && !ejecEnviada && (
                  <Callout tono="warn" ico="⚠">
                    Esta acción ejecutará el plan real aprobado en Google Ads. Puede comprometer hasta <b>{clp(env.experimentBudget)}</b> dentro del cap global de <b>{clp(env.totalCap)}</b>. Se ejecutarán <b>{exec?.summary?.executionActionCount ?? 59}</b> acciones. ¿Ejecutar ahora?
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" className="btn" onClick={() => setConfirmando(false)}>CANCELAR</button>
                      <button type="button" className="btn primary" onClick={() => void ejecutarPlan()}>EJECUTAR AHORA</button>
                    </div>
                  </Callout>
                )}

                {ejecEnviada && <Callout tono="info" ico="🛰">{ejecMsg}</Callout>}
              </div>

              <button type="button" className="btn" style={{ marginTop: 10 }} disabled={cargando} onClick={() => void accion('envelope-revoke')}>Revocar autorización</button>
            </div>
          )}
          {error && <Callout tono="warn" ico="⚠">{error}</Callout>}
        </div>
      )}
    </div>
  );
}
