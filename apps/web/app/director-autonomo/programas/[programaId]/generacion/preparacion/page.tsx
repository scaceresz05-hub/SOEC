'use client';

/**
 * Preparación del CONOCIMIENTO COMERCIAL antes de generar (A-1). Flujo mínimo y estructurado (no formularios
 * JSON): ver cobertura y faltantes, crear/completar empresa, producto e ICP, crear hipótesis y asociarla a un
 * segmento, agregar evidencia. Sin este paso, el motor ABSTIENE. Sesión en cookie httpOnly; todo SIMULADO.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { yo } from '../../../../../../lib/auth-client';
import {
  agregarEvidencia,
  asociarSegmento,
  cobertura,
  crearEntidad,
  crearHipotesis,
  establecerCampo,
  listarEntidades,
  listarHipotesis,
  type CoberturaComercial,
  type EntidadCrm,
  type HipotesisCrm,
} from '../../../../../../lib/crm-client';

export default function PreparacionPage() {
  const params = useParams<{ programaId: string }>();
  const programaId = decodeURIComponent(String(params?.programaId ?? ''));
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [org, setOrg] = useState('');
  const [cov, setCov] = useState<CoberturaComercial | null>(null);
  const [entidades, setEntidades] = useState<EntidadCrm[]>([]);
  const [hips, setHips] = useState<HipotesisCrm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Formularios (estructurados).
  const [ent, setEnt] = useState({ id: '', tipo: 'CLIENTE_IDEAL', nombre: '' });
  const [campo, setCampo] = useState({ id: '', clave: '', valor: '' });
  const [hip, setHip] = useState({ id: '', enunciado: '', segmentoId: '' });
  const [evi, setEvi] = useState({ id: '', descripcion: '' });

  useEffect(() => {
    yo().then((s) => {
      if (!s) { setError('Necesitas iniciar sesión.'); return; }
      setOrgs(s.organizaciones.map((o) => ({ slug: o.slug, name: o.name })));
      if (s.organizaciones[0]) setOrg((p) => p || s.organizaciones[0]!.slug);
    }).catch(() => setError('No se pudo consultar la sesión.'));
  }, []);

  const refrescar = useCallback(async (o: string) => {
    if (!o) return;
    const [c, e, h] = await Promise.all([cobertura(o), listarEntidades(o), listarHipotesis(o)]);
    setCov(c); setEntidades(e.entidades); setHips(h.hipotesis);
  }, []);
  useEffect(() => { if (org) refrescar(org).catch(() => undefined); }, [org, refrescar]);

  async function accion(fn: () => Promise<unknown>, ok: string) {
    setCargando(true); setError(null); setMsg(null);
    try { await fn(); await refrescar(org); setMsg(ok); } catch (e) { setError((e as Error).message); } finally { setCargando(false); }
  }

  const icps = entidades.filter((e) => e.tipo === 'CLIENTE_IDEAL');

  return (
    <div>
      <h1>Preparación del conocimiento comercial</h1>
      <p className="muted">Carga lo mínimo que el motor necesita, luego vuelve a{' '}
        <Link href={`/director-autonomo/programas/${encodeURIComponent(programaId)}/generacion`}>generación</Link>.</p>

      <div className="card" style={{ marginBottom: 12 }}>
        <label>Organización{' '}
          <select value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">—</option>
            {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name} ({o.slug})</option>)}
          </select>
        </label>
      </div>

      {msg && <div className="aviso" style={{ marginBottom: 12 }}><strong>{msg}</strong></div>}
      {error && <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>{error}</div>}

      {cov && (
        <div className={`aviso ${cov.listoParaGenerar ? '' : 'aviso--danger'}`} style={{ marginBottom: 12 }}>
          <strong>Cobertura:</strong> empresa {cov.empresa ? '✓' : '✗'} · producto/servicio {cov.productoOServicio ? '✓' : '✗'} · ICP {cov.icps} · hipótesis con segmento {cov.hipotesisConSegmento}
          {cov.listoParaGenerar ? ' — listo para generar.' : <ul>{cov.faltantes.map((f, i) => <li key={i} className="small">{f}</li>)}</ul>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>1. Entidad (empresa / producto / ICP)</h2>
        <div className="small">
          <input placeholder="id (ej. empresa, p1, icp1)" value={ent.id} onChange={(e) => setEnt({ ...ent, id: e.target.value })} />{' '}
          <select value={ent.tipo} onChange={(e) => setEnt({ ...ent, tipo: e.target.value })}>
            {['EMPRESA', 'PRODUCTO', 'SERVICIO', 'CLIENTE_IDEAL', 'COMPETIDOR', 'MERCADO'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>{' '}
          <input placeholder="nombre" value={ent.nombre} onChange={(e) => setEnt({ ...ent, nombre: e.target.value })} />{' '}
          <button className="btn" disabled={cargando || !org || !ent.id.trim() || !ent.nombre.trim()} onClick={() => void accion(() => crearEntidad(org, ent.id.trim(), ent.tipo, ent.nombre.trim()), 'Entidad creada.')}>Crear</button>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          <strong>Campo:</strong>{' '}
          <input placeholder="id entidad" value={campo.id} onChange={(e) => setCampo({ ...campo, id: e.target.value })} />{' '}
          <input placeholder="clave (ej. propuestaValor, dolores)" value={campo.clave} onChange={(e) => setCampo({ ...campo, clave: e.target.value })} />{' '}
          <input placeholder="valor" value={campo.valor} onChange={(e) => setCampo({ ...campo, valor: e.target.value })} />{' '}
          <button className="btn" disabled={cargando || !org || !campo.id.trim() || !campo.clave.trim() || !campo.valor.trim()} onClick={() => void accion(() => establecerCampo(org, campo.id.trim(), campo.clave.trim(), campo.valor.trim()), 'Campo establecido.')}>Guardar</button>
        </div>
        <ul>{entidades.map((e) => <li key={e.id} className="small"><span className="chip">{e.tipo}</span> {e.id} · {e.nombre} <span className="muted">({Object.keys(e.campos).join(', ') || 'sin campos'})</span></li>)}</ul>
      </div>

      <div className="card">
        <h2>2. Hipótesis comercial (asociada a un ICP)</h2>
        <div className="small">
          <input placeholder="id (ej. h1)" value={hip.id} onChange={(e) => setHip({ ...hip, id: e.target.value })} />{' '}
          <input placeholder="enunciado" value={hip.enunciado} onChange={(e) => setHip({ ...hip, enunciado: e.target.value })} style={{ width: 280 }} />{' '}
          <select value={hip.segmentoId} onChange={(e) => setHip({ ...hip, segmentoId: e.target.value })}>
            <option value="">— segmento/ICP —</option>
            {icps.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.id})</option>)}
          </select>{' '}
          <button className="btn" disabled={cargando || !org || !hip.id.trim() || !hip.enunciado.trim()} onClick={() => void accion(() => crearHipotesis(org, hip.id.trim(), hip.enunciado.trim(), 'canales', hip.segmentoId || undefined), 'Hipótesis creada.')}>Crear</button>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          <strong>Evidencia:</strong>{' '}
          <input placeholder="id hipótesis" value={evi.id} onChange={(e) => setEvi({ ...evi, id: e.target.value })} />{' '}
          <input placeholder="descripción" value={evi.descripcion} onChange={(e) => setEvi({ ...evi, descripcion: e.target.value })} style={{ width: 240 }} />{' '}
          <button className="btn" disabled={cargando || !org || !evi.id.trim() || !evi.descripcion.trim()} onClick={() => void accion(() => agregarEvidencia(org, evi.id.trim(), evi.descripcion.trim()), 'Evidencia agregada.')}>Agregar</button>
        </div>
        <ul>{hips.map((h) => (
          <li key={h.id} className="small">
            {h.id} · {h.enunciado} <span className="chip">{h.estado}</span> {h.segmentoId ? <span className="chip">segmento: {h.segmentoId}</span> : <span className="chip badge--danger">sin segmento</span>} <span className="muted">({h.evidencias} evidencia/s)</span>
            {!h.segmentoId && icps[0] && <> <button className="btn" disabled={cargando} onClick={() => void accion(() => asociarSegmento(org, h.id, icps[0]!.id), 'Segmento asociado.')}>Asociar a {icps[0]!.id}</button></>}
          </li>
        ))}</ul>
      </div>
    </div>
  );
}
