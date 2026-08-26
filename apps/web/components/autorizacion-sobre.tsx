'use client';

/**
 * AUTORIZACIÓN DE EJECUCIÓN — soberanía financiera humana. Muestra el sobre (tope TOTAL, experimento, máximo
 * gasto sin contacto, período, canal, stop rules, hash del plan) y el botón para AUTORIZAR. La autorización es
 * una acción HUMANA (financiera): SOEC/Chrome no la pulsan. Nada se ejecuta: los flags de ejecución están en false.
 */
import { useCallback, useEffect, useState } from 'react';
import { cabecerasOrg } from '../lib/org-activa';
import { Badge, Callout } from './ui';

interface Envelope {
  id: string; planId: string; status: string; objective: string; currency: string;
  totalCap: number; experimentBudget: number; maxSpendWithoutContact: number;
  startsAt: string | null; expiresAt: string | null;
  plannedChannels: string[]; authorizedChannels: string[]; authorizedActionTypes: string[];
  stopRules: { id: string; tipo?: string; enabled: boolean; threshold?: number | null; date?: string | null; condition?: string; reason?: string }[];
  planVersion: string; planHash: string; approvedBy: string | null; approvedAt: string | null;
}
interface Financial { historicalSpend: number; envelopeSpend: number; committedSpend: number; remainingCap: number }
interface Resp { envelope: Envelope | null; financial: Financial; executionAllowed: { decision: string; reasonCode: string | null }; autonomousReal: boolean; supervisedReal: boolean }

const clp = (n: number): string => `$${Math.round(n).toLocaleString('es-CL')}`;
const nombreCanal = (c: string): string => (c === 'google' ? 'Google Ads' : c === 'meta' ? 'Meta Ads' : c);
/** Texto material de una stop rule (valores completos, no sólo el tipo). */
function stopTxt(s: { id: string; enabled: boolean; threshold?: number | null; date?: string | null; condition?: string; reason?: string }): string {
  if (!s.enabled) return `DESACTIVADO${s.reason ? ` (${s.reason})` : ''}`;
  if (s.id === 'STOP_BUDGET') return clp(s.threshold ?? 0);
  if (s.id === 'STOP_ZERO_CONVERSION') return `${clp(s.threshold ?? 0)} sin contacto`;
  if (s.id === 'STOP_CPA') return s.threshold != null ? `CPA > ${clp(s.threshold)}` : 'DESACTIVADO';
  if (s.id === 'STOP_PERIOD') return `hasta ${s.date?.slice(0, 10) ?? '—'}`;
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
  const [cargando, setCargando] = useState(false);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // HIDRATACIÓN read-only: al montar / cambiar de tenant / re-simular, se lee el envelope PERSISTIDO (GET).
  const cargar = useCallback(async () => {
    if (!org) { setCargandoInicial(false); return; }
    setError(null);
    try {
      const r = await fetch('/api/medicion/envelope', { headers: cabecerasOrg(org), cache: 'no-store' });
      if (!r.ok) { setError('No pudimos leer el estado del sobre.'); return; }
      setResp((await r.json()) as Resp);
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

  const env = resp?.envelope;
  const st = env ? (ESTADO[env.status] ?? { txt: env.status, tono: 'info' as const }) : null;
  const aprobado = env ? ['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'ACTIVE'].includes(env.status) : false;

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

      {!cargandoInicial && env && (
        <div style={{ marginTop: 10 }}>
          <ul className="s" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Objetivo:</b> {env.objective}</li>
            <li><b>Sobre / Plan:</b> <code>{env.id}</code> · <code>{env.planId}</code></li>
            <li style={{ marginTop: 4 }}><b>TOPE TOTAL AUTORIZADO:</b> {clp(env.totalCap)} <span className="muted">(máximo absoluto del sobre — STOP_BUDGET)</span></li>
            <li><b>PRESUPUESTO DEL PRIMER EXPERIMENTO:</b> {clp(env.experimentBudget)} <span className="muted">(distinto del tope total)</span></li>
            <li><b>CORTE SI NO HAY CONTACTOS:</b> {clp(env.maxSpendWithoutContact)}</li>
            <li style={{ marginTop: 4 }}><b>Período:</b> {env.startsAt?.slice(0, 10)} → {env.expiresAt?.slice(0, 10)}</li>
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

          {env.status === 'READY_FOR_HUMAN_APPROVAL' && (
            <>
              <Callout tono="warn" ico="✍">
                Autorizo a SOEC a ejecutar las acciones publicitarias indicadas para este plan durante el período mostrado, con un <b>máximo TOTAL de {clp(env.totalCap)}</b>. El primer experimento tiene un presupuesto máximo de <b>{clp(env.experimentBudget)}</b> y SOEC deberá detener el gasto si alcanza <b>{clp(env.maxSpendWithoutContact)}</b> sin obtener un contacto real atribuible, además de las demás reglas de detención mostradas.
              </Callout>
              <button type="button" className="btn primary" disabled={cargando} onClick={() => void accion('envelope-approve')}>{cargando ? 'Autorizando…' : 'AUTORIZAR SOBRE DE EJECUCIÓN'}</button>
            </>
          )}

          {aprobado && (
            <div style={{ marginTop: 8 }}>
              <p className="s">Autorizado por <b>{env.approvedBy}</b> el {env.approvedAt?.slice(0, 10)}. La ejecución real permanece bloqueada por el gate externo y por los interruptores de seguridad.</p>
              <button type="button" className="btn" disabled={cargando} onClick={() => void accion('envelope-revoke')}>Revocar autorización</button>
            </div>
          )}
          {error && <Callout tono="warn" ico="⚠">{error}</Callout>}
        </div>
      )}
    </div>
  );
}
