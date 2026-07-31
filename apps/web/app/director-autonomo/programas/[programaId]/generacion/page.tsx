'use client';

/**
 * Motor de Generación Autónoma de Marketing — vista operativa por programa (Macrobloque 3, Tramo K).
 * Muestra, sobre la superficie AUTENTICADA (proxy /api/backend/*), lo que el núcleo genera: estrategia
 * creativa, campañas, contenido, variantes A/B, calendario editorial y aprobaciones humanas. Distingue
 * REAL / SIMULADO / ESTIMADO / DESCONOCIDO y exige aprobación humana antes de ejecutar (todo SIMULADO).
 * La sesión viaja en cookie httpOnly: el navegador nunca lee ni almacena tokens.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { yo } from '../../../../../lib/auth-client';
import {
  aprobarPieza,
  ejecutarSimulado,
  estadoGeneracion,
  iniciarGeneracion,
  listarAprobaciones,
  listarCalendario,
  listarCampanias,
  listarContenido,
  listarEstrategias,
  listarExperimentos,
  reintentarGeneracion,
} from '../../../../../lib/generacion-client';
import type {
  AprobacionGen,
  ArtefactoEstrategia,
  CampaniaGen,
  EntradaCalendarioGen,
  EstadoGeneracion,
  ExperimentoGen,
  Naturaleza,
  PiezaGen,
} from '../../../../../lib/generacion-types';

const PARAMS_DEMO = {
  objetivoComercial: 'crecer ventas', objetivoMarketing: 'generar leads', indicador: 'leads', valorEsperado: 100,
  horizonteDias: 30, prioridad: 'alta', presupuestoTotal: 100000, frecuenciaDias: 2, canales: ['correo'],
};

function Nat({ n }: { n: Naturaleza | string }) {
  const cls = n === 'REAL' ? 'badge--ok' : n === 'SIMULADO' ? 'badge--warn' : n === 'ESTIMADO' ? 'badge--reserved' : 'badge--danger';
  return <span className={`badge ${cls}`}>{n}</span>;
}

export default function GeneracionPage() {
  const params = useParams<{ programaId: string }>();
  const programaId = decodeURIComponent(String(params?.programaId ?? ''));
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [org, setOrg] = useState('');
  const [estado, setEstado] = useState<EstadoGeneracion | null>(null);
  const [estrategias, setEstrategias] = useState<ArtefactoEstrategia[]>([]);
  const [campanias, setCampanias] = useState<CampaniaGen[]>([]);
  const [contenido, setContenido] = useState<PiezaGen[]>([]);
  const [experimentos, setExperimentos] = useState<ExperimentoGen[]>([]);
  const [calendario, setCalendario] = useState<EntradaCalendarioGen[]>([]);
  const [aprobaciones, setAprobaciones] = useState<AprobacionGen[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    yo()
      .then((s) => {
        if (!s) { setError('Necesitas iniciar sesión para operar el motor de generación.'); return; }
        setOrgs(s.organizaciones.map((o) => ({ slug: o.slug, name: o.name })));
        if (s.organizaciones[0]) setOrg((prev) => prev || s.organizaciones[0]!.slug);
      })
      .catch(() => setError('No se pudo consultar la sesión.'));
  }, []);

  const refrescar = useCallback(async (o: string) => {
    if (!o || !programaId) return;
    const [e, es, ca, co, ex, cal, ap] = await Promise.all([
      estadoGeneracion(o, programaId).catch(() => null),
      listarEstrategias(o, programaId).catch(() => ({ estrategias: [] })),
      listarCampanias(o, programaId).catch(() => ({ campanias: [] })),
      listarContenido(o, programaId).catch(() => ({ piezas: [] })),
      listarExperimentos(o, programaId).catch(() => ({ experimentos: [] })),
      listarCalendario(o, programaId).catch(() => ({ entradas: [] })),
      listarAprobaciones(o, programaId).catch(() => ({ aprobaciones: [] })),
    ]);
    setEstado(e);
    setEstrategias(es.estrategias);
    setCampanias(ca.campanias);
    setContenido(co.piezas);
    setExperimentos(ex.experimentos);
    setCalendario(cal.entradas);
    setAprobaciones(ap.aprobaciones);
  }, [programaId]);

  useEffect(() => {
    if (org) refrescar(org).catch(() => undefined);
  }, [org, refrescar]);

  async function accion(fn: () => Promise<unknown>, ok?: string) {
    setCargando(true);
    setError(null);
    setMensaje(null);
    try {
      await fn();
      await refrescar(org);
      if (ok) setMensaje(ok);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  const piezasSinAprobar = aprobaciones.filter((a) => a.ultima?.decision !== 'APROBADA');
  const todasAprobadas = aprobaciones.length > 0 && piezasSinAprobar.length === 0;

  return (
    <div>
      <h1>Motor de Generación · {programaId || '—'}</h1>
      <p className="muted">
        Genera y opera la estrategia creativa, campañas, contenido, variantes A/B y calendario del
        programa, con aprobación humana antes de ejecutar. Configura el programa en{' '}
        <Link href="/director-autonomo/programas">Director Autónomo · Programas</Link>.
      </p>
      <div className="aviso" style={{ marginBottom: 8 }}>
        Todo lo que ves es <Nat n="SIMULADO" />: sin proveedores externos, sin gasto ni publicación real.
        Leyenda: <Nat n="REAL" /> observado · <Nat n="SIMULADO" /> generado · <Nat n="ESTIMADO" /> inferido · <Nat n="DESCONOCIDO" /> sin evidencia.
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Organización{' '}
          <select value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">—</option>
            {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name} ({o.slug})</option>)}
          </select>
        </label>
        <div style={{ marginTop: 10 }}>
          <button className="btn" disabled={cargando || !org} onClick={() => void accion(() => iniciarGeneracion(org, programaId, PARAMS_DEMO), 'Generación preparada (piezas en espera de aprobación).')}>Iniciar generación</button>{' '}
          <button className="btn" disabled={cargando || !org} onClick={() => void accion(() => reintentarGeneracion(org, programaId, PARAMS_DEMO), 'Reintento completado.')}>Reintentar</button>{' '}
          <button className="btn" disabled={cargando || !org || !todasAprobadas} onClick={() => void accion(() => ejecutarSimulado(org, programaId), 'Ciclo simulado ejecutado.')}>Ejecutar simulado</button>
        </div>
        {!todasAprobadas && aprobaciones.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>Faltan {piezasSinAprobar.length} aprobación(es) humana(s) antes de poder ejecutar.</p>}
      </div>

      {mensaje && <div className="aviso" style={{ marginBottom: 12 }}><strong>{mensaje}</strong></div>}
      {error && <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>{error}</div>}
      {cargando && <p className="muted">Trabajando…</p>}

      {estado && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2>Estado del programa <Nat n={estado.naturaleza} /></h2>
          <div className="chip">estado: {estado.estado}</div>
          <div className="chip">segmentos: {estado.segmentos}</div>
          <div className="chip">campañas: {estado.campanias}</div>
          <div className="chip">piezas: {estado.piezas}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Estrategia creativa ({estrategias.length})</h2>
        {estrategias.length === 0 ? <p className="muted">Sin estrategias aún. Inicia la generación.</p> : estrategias.map((e) => (
          <div key={e.estrategiaCreativaId} className="card" style={{ marginBottom: 8 }}>
            <strong>{e.concepto}</strong> · <em>{e.angulo}</em> <Nat n={e.naturaleza} /> <span className="chip">v{e.version}</span> <span className="chip">confianza: {e.confianza}</span>
            <p className="small"><strong>Gancho:</strong> {e.gancho}</p>
            <p className="small"><strong>CTA:</strong> {e.cta} · <strong>Tono:</strong> {e.tono}</p>
            <p className="small"><strong>Afirmaciones permitidas:</strong> {e.afirmacionesPermitidas.join(' · ') || '—'}</p>
            <p className="small"><strong>Prueba social:</strong> {e.pruebaSocialPermitida ? 'permitida' : 'no se inventa'} · <strong>Evidencias:</strong> {e.evidencias.length}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Campañas ({campanias.length}) y contenido ({contenido.length})</h2>
        {campanias.map((c) => (
          <div key={c.campaignId} className="card" style={{ marginBottom: 8 }}>
            <strong>{c.campaignId}</strong> · hipótesis {c.hipotesisId} <span className="chip">{c.piezas.length} pieza(s)</span>
            <div className="small">Piezas: {c.piezas.map((id) => <span key={id} className="chip">{id} <Nat n="SIMULADO" /></span>)}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Variantes A/B ({experimentos.length})</h2>
        {experimentos.length === 0 ? <p className="muted">Sin experimentos aún.</p> : experimentos.map((x) => (
          <div key={x.piezaId} className="card" style={{ marginBottom: 8 }}>
            <strong>{x.piezaId}</strong>
            <ul>{x.variantes.map((v) => <li key={v.varianteId} className="small">cambia <span className="chip">{v.elementoModificado}</span> — {v.diferenciaControlada} <span className="chip">{v.estado}</span></li>)}</ul>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Calendario editorial ({calendario.length})</h2>
        {calendario.length === 0 ? <p className="muted">Sin entradas aún.</p> : (
          <ul>{calendario.map((c) => <li key={c.entradaId} className="small">{new Date(c.fechaHora).toLocaleString('es-CL')} · {c.canal} · {c.segmento} <span className="chip">{c.estado}</span> <Nat n={c.naturaleza} /></li>)}</ul>
        )}
      </div>

      <div className="card">
        <h2>Aprobaciones humanas ({aprobaciones.length})</h2>
        {aprobaciones.length === 0 ? <p className="muted">Sin piezas para aprobar aún.</p> : aprobaciones.map((a) => (
          <div key={a.resourceId} className="small" style={{ marginBottom: 6 }}>
            {a.resourceId} —{' '}
            {a.ultima?.decision === 'APROBADA'
              ? <><span className="chip">APROBADA</span> por {a.ultima.actorUserId}</>
              : (
                <>
                  <span className="chip">pendiente</span>{' '}
                  <button className="btn" disabled={cargando || !org} onClick={() => void accion(() => aprobarPieza(org, programaId, a.resourceId, 1), 'Pieza aprobada.')}>Aprobar (como humano)</button>
                </>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}
