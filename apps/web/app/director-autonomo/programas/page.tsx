'use client';

/**
 * Director Autónomo · Programas — configura y opera programas de marketing POR NEGOCIO sobre el
 * store real. Extiende el Director Autónomo (el ciclo demo fijo sigue en /director-autonomo).
 * Distingue visualmente CONFIGURADO / SIMULADO / INFERIDO / INFORMACIÓN FALTANTE, y avisa de
 * forma permanente que todo es simulado. La página organiza lo que produce el núcleo.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { configurarSmileFlowDemo, ejecutarCiclo, listarOrganizaciones, listarProgramas, obtenerPrograma, pausar, reanudar } from '../../../lib/programas-client';
import type { VistaPrograma } from '../../../lib/programas-types';
import { AVISO_PAUSA_ORG, AVISO_PILOTO_SIN_AUTH, AVISO_SIMULACION, MSG_ORG_PAUSADA, MSG_ORG_REANUDADA } from '../../../lib/programas-avisos';

function Tag({ tipo }: { tipo: 'CONFIGURADO' | 'SIMULADO' | 'INFERIDO' | 'FALTANTE' }) {
  const cls = tipo === 'SIMULADO' ? 'badge--warn' : tipo === 'INFERIDO' ? 'badge--reserved' : tipo === 'FALTANTE' ? 'badge--danger' : 'badge--ok';
  const txt = tipo === 'FALTANTE' ? 'INFORMACIÓN FALTANTE' : tipo;
  return <span className={`badge ${cls}`}>{txt}</span>;
}

export default function ProgramasPage() {
  const [orgs, setOrgs] = useState<{ org: string; nombre: string }[]>([]);
  const [org, setOrg] = useState('');
  const [programas, setProgramas] = useState<{ programaId: string; nombre: string }[]>([]);
  const [programaId, setProgramaId] = useState('');
  const [vista, setVista] = useState<VistaPrograma | null>(null);
  const [actor, setActor] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const refrescarOrgs = useCallback(async () => {
    const r = await listarOrganizaciones();
    setOrgs(r.organizaciones);
    if (!org && r.organizaciones[0]) setOrg(r.organizaciones[0].org);
  }, [org]);

  useEffect(() => {
    refrescarOrgs().catch(() => setError('No se pudo cargar la lista de organizaciones.'));
  }, [refrescarOrgs]);

  const refrescarProgramas = useCallback(async (o: string) => {
    if (!o) return;
    const r = await listarProgramas(o);
    setProgramas(r.programas);
    if (r.programas[0]) setProgramaId((prev) => (r.programas.some((p) => p.programaId === prev) ? prev : r.programas[0]!.programaId));
    else setProgramaId('');
  }, []);

  useEffect(() => {
    if (org) refrescarProgramas(org).catch(() => setError('No se pudieron cargar los programas.'));
  }, [org, refrescarProgramas]);

  const refrescarVista = useCallback(async (o: string, p: string) => {
    if (!o || !p) { setVista(null); return; }
    setVista(await obtenerPrograma(o, p));
  }, []);

  useEffect(() => {
    if (org && programaId) refrescarVista(org, programaId).catch(() => setVista(null));
  }, [org, programaId, refrescarVista]);

  async function accion<T>(fn: () => Promise<T>, despues?: (r: T) => void) {
    setCargando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await fn();
      despues?.(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <h1>Director Autónomo · Programas</h1>
      <p className="muted">
        Configura un programa de marketing para un negocio concreto y opera su ciclo autónomo. El
        ciclo de demostración fijo sigue en <Link href="/director-autonomo">/director-autonomo</Link>.
      </p>
      <div className="aviso" style={{ marginBottom: 8 }}>
        {AVISO_SIMULACION} (modo <Tag tipo="SIMULADO" />)
      </div>
      <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>
        {AVISO_PILOTO_SIN_AUTH}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div>
          <button className="btn" disabled={cargando} onClick={() => void accion(() => configurarSmileFlowDemo(), async (r) => { await refrescarOrgs(); setOrg(r.org); await refrescarProgramas(r.org); setProgramaId(r.programaId); await refrescarVista(r.org, r.programaId); })}>
            Cargar programa SmileFlow (demostración sintética)
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Organización{' '}
            <select value={org} onChange={(e) => setOrg(e.target.value)}>
              <option value="">—</option>
              {orgs.map((o) => <option key={o.org} value={o.org}>{o.nombre} ({o.org})</option>)}
            </select>
          </label>{' '}
          <label>Programa{' '}
            <select value={programaId} onChange={(e) => setProgramaId(e.target.value)}>
              <option value="">—</option>
              {programas.map((p) => <option key={p.programaId} value={p.programaId}>{p.nombre}</option>)}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn" disabled={cargando || !programaId} onClick={() => void accion(() => ejecutarCiclo(org, programaId), setVista)}>Ejecutar ciclo (simulado)</button>{' '}
          <button className="btn" disabled={cargando || !programaId} onClick={() => void accion(() => pausar(org, programaId), (r) => { setVista(r.vista); setMensaje(MSG_ORG_PAUSADA); })}>Pausar</button>{' '}
          <input placeholder="actor humano" value={actor} onChange={(e) => setActor(e.target.value)} style={{ width: 160 }} />{' '}
          <button className="btn" disabled={cargando || !programaId || !actor.trim()} onClick={() => void accion(() => reanudar(org, programaId, actor.trim()), (r) => { setVista(r.vista); setMensaje(MSG_ORG_REANUDADA); })}>Reanudar</button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>{AVISO_PAUSA_ORG}</p>
      </div>

      {mensaje && <div className="aviso" style={{ marginBottom: 12 }}><strong>{mensaje}</strong></div>}
      {error && <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>{error}</div>}
      {cargando && <p className="muted">Cargando…</p>}

      {vista && (
        <>
          {vista.modoSeguro && <div className="aviso aviso--danger" style={{ marginBottom: 12 }}><strong>MODO SEGURO (PAUSA) activo.</strong> El ciclo no se ejecuta; reanude con un actor humano.</div>}

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>{vista.nombre}</h2>
            <div className="chip">estado: {vista.estadoPrograma}</div>
            <div className="chip">autonomía: N{vista.nivelAutonomia}</div>
            <div className="chip">modo: {vista.modoEjecucion}</div>
            <p><strong>Objetivo:</strong> {vista.objetivoPrincipal} <Tag tipo="CONFIGURADO" /></p>
            <p className="small"><strong>Presupuesto simulado:</strong> {vista.presupuesto.comprometidoSimulado.toLocaleString('es-CL')} / {vista.presupuesto.totalSimulado.toLocaleString('es-CL')} {vista.presupuesto.moneda} <Tag tipo="CONFIGURADO" /></p>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Segmentos ({vista.segmentos.length}) e hipótesis ({vista.hipotesis.length}) <Tag tipo="CONFIGURADO" /></h2>
            {vista.segmentos.map((s) => <div key={s.id} className="chip">#{s.prioridad} {s.nombre}</div>)}
            <ul>{vista.hipotesis.map((h) => <li key={h.id} className="small">{h.mensaje} <span className="chip">{h.estado}</span></li>)}</ul>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Campañas ({vista.campanias.length})</h2>
            {vista.campanias.map((c) => (
              <div key={c.campaignId} className="card" style={{ marginBottom: 8 }}>
                <strong>{c.nombreSegmento}</strong> · {c.publico} · <span className="chip">{c.estadoCampania}</span>
                <span className="chip">{c.presupuestoSimulado.toLocaleString('es-CL')} simulado</span>
                <div className="small">Contenidos: {c.contenidos.map((ct) => <span key={ct.contenidoId} className="chip">{ct.estado}</span>)}</div>
                <div className="small">Ejecuciones: {c.ejecuciones.length === 0 ? <span className="muted">ninguna</span> : c.ejecuciones.map((e) => <span key={e.requestId} className="chip">{e.resultado} <Tag tipo="SIMULADO" /></span>)}</div>
                <div className="small">ROI: {c.roi.valor ?? '—'} <Tag tipo={c.roi.naturaleza === 'SIMULADO' ? 'SIMULADO' : c.roi.naturaleza === 'DESCONOCIDO' ? 'FALTANTE' : 'INFERIDO'} /> <em>(clasificación: {c.roi.clasificacion})</em></div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Aprendizajes ({vista.aprendizajes.length}) <Tag tipo="INFERIDO" /></h2>
            {vista.aprendizajes.length === 0 ? <p className="muted">Aún no hay aprendizajes.</p> : <ul>{vista.aprendizajes.map((a, i) => <li key={i} className="small">{a.conclusion} {a.reutilizable && <span className="chip">reutilizable</span>}</li>)}</ul>}
          </div>

          <div className="card">
            <h2>Próxima recomendación</h2>
            <p>{vista.proximaRecomendacion}</p>
          </div>
        </>
      )}
    </div>
  );
}
