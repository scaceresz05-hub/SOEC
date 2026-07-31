'use client';

/**
 * Director Autónomo — cableado del núcleo del ciclo de marketing autónomo (paquetes A–J) al
 * producto. Muestra el ciclo gobernado sobre el store real: objetivo, autonomía, modo seguro
 * (PAUSA), evaluabilidad, decisión, pendientes, ejecuciones SIMULADAS, bloqueos, resultado (con
 * su naturaleza REAL/SIMULADO/ESTIMADO/DESCONOCIDO), aprendizajes y próxima recomendación.
 * La página NO interpreta: organiza lo que produce el núcleo. La ejecución es simulada; no hay
 * efectos externos reales.
 */
import { useCallback, useEffect, useState } from 'react';
import { ejecutarCiclo, obtenerEstado, pausar, reanudar } from '../../lib/director-autonomo-client';
import type { Naturaleza, VistaCicloDirector } from '../../lib/director-autonomo-types';

interface OrgDemo {
  id: string;
  descripcion: string;
}

const BADGE: Record<Naturaleza, string> = {
  REAL: 'badge--ok',
  SIMULADO: 'badge--warn',
  ESTIMADO: 'badge--reserved',
  DESCONOCIDO: 'badge--danger',
};

function BadgeNaturaleza({ n }: { n: Naturaleza }) {
  return <span className={`badge ${BADGE[n]}`}>{n}</span>;
}

export default function DirectorAutonomoPage() {
  const [orgs, setOrgs] = useState<OrgDemo[]>([]);
  const [org, setOrg] = useState<string>('');
  const [vista, setVista] = useState<VistaCicloDirector | null>(null);
  const [actor, setActor] = useState<string>('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/catalogo', { cache: 'no-store' })
      .then((r) => r.json())
      .then((cat: { organizaciones?: OrgDemo[] }) => {
        const lista = cat.organizaciones ?? [];
        setOrgs(lista);
        if (lista[0]) setOrg(lista[0].id);
      })
      .catch(() => setError('No se pudo cargar el catálogo de organizaciones.'));
  }, []);

  const refrescar = useCallback(async (o: string) => {
    if (!o) return;
    setCargando(true);
    setError(null);
    try {
      setVista(await obtenerEstado(o));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (org) void refrescar(org);
  }, [org, refrescar]);

  async function accion(fn: () => Promise<VistaCicloDirector>) {
    setCargando(true);
    setError(null);
    try {
      setVista(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <h1>Director Autónomo</h1>
      <p className="muted">
        El ciclo de marketing autónomo gobernado, sobre el store real. SOEC decide, ejecuta (de
        forma <strong>simulada</strong>), mide y aprende bajo autorización humana. Ningún efecto
        externo es real; cada dato declara su naturaleza.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>
          Organización activa{' '}
          <select value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.descripcion} ({o.id})
              </option>
            ))}
          </select>
        </label>
        <div style={{ marginTop: 10 }}>
          <button className="btn" disabled={cargando || !org} onClick={() => void accion(() => ejecutarCiclo(org).then((r) => r.vista))}>
            Ejecutar ciclo gobernado (simulado)
          </button>{' '}
          <button className="btn" disabled={cargando || !org} onClick={() => void accion(() => pausar(org, 'pausa desde el Director Autónomo'))}>
            Pausar (modo seguro)
          </button>{' '}
          <input placeholder="actor humano (para reanudar)" value={actor} onChange={(e) => setActor(e.target.value)} style={{ width: 220 }} />{' '}
          <button className="btn" disabled={cargando || !org || !actor.trim()} onClick={() => void accion(() => reanudar(org, actor.trim(), 'reanudación desde el Director Autónomo'))}>
            Reanudar
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          <strong>V1 controlada · escenario de demostración.</strong> «Ejecutar ciclo» corre un
          caso <em>sintético</em> (datos de demostración, ids deterministas por organización) para
          mostrar el gobierno del ciclo; no es una campaña real de esta organización. La ejecución
          es simulada y no produce efectos externos.
        </p>
      </div>

      {error && <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>{error}</div>}
      {cargando && <p className="muted">Cargando…</p>}

      {vista && (
        <>
          {vista.modoSeguro && (
            <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>
              <strong>MODO SEGURO (PAUSA) activo.</strong> Ninguna acción con efecto procede;
              requiere reanudación por un actor humano. La PAUSA prevalece incluso sobre
              aprobaciones previas.
            </div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Estado del ciclo</h2>
            <div className="chip">org: {vista.organizacionActiva}</div>
            <div className="chip">nivel de autonomía: N{vista.nivelAutonomia}</div>
            <div className="chip">modo seguro: {vista.modoSeguro ? 'SÍ' : 'no'}</div>
            <div className="chip">evaluabilidad: {vista.calidadEvaluabilidad}</div>
            <p style={{ marginTop: 10 }}>
              <strong>Objetivo:</strong> {vista.objetivo.valor ?? '—'} <BadgeNaturaleza n={vista.objetivo.naturaleza} />
              <br />
              <span className="muted small">{vista.objetivo.nota}</span>
            </p>
            {vista.justificacion && (
              <p className="small">
                <strong>Justificación:</strong> {vista.justificacion}
              </p>
            )}
            <p>
              <strong>Decisión:</strong> {vista.decision.valor ?? '—'} <BadgeNaturaleza n={vista.decision.naturaleza} />
            </p>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Resultado (ROI)</h2>
            <p>
              {vista.resultado.valor !== null ? vista.resultado.valor : 'sin resultado'}{' '}
              <BadgeNaturaleza n={vista.resultado.naturaleza} />
            </p>
            <p className="muted small">{vista.resultado.nota}</p>
            {vista.resultado.naturaleza !== 'REAL' && vista.resultado.valor !== null && (
              <p className="small">
                <em>Este ROI es ilustrativo, NO real: la campaña se ejecutó de forma simulada.</em>
              </p>
            )}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Ejecuciones simuladas ({vista.ejecucionesSimuladas.length})</h2>
            {vista.ejecucionesSimuladas.length === 0 && <p className="muted">Aún no hay ejecuciones.</p>}
            {vista.ejecucionesSimuladas.map((e) => (
              <div key={e.requestId} className="small">
                <code>{e.requestId}</code> · canal {e.canal} · <strong>{e.resultado}</strong> <BadgeNaturaleza n={e.naturaleza} />
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Pendientes ({vista.pendientes.length})</h2>
            {vista.pendientes.length === 0 && <p className="muted">Sin pendientes.</p>}
            <ul>
              {vista.pendientes.map((p, i) => (
                <li key={i} className="small">{p}</li>
              ))}
            </ul>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Bloqueos ({vista.bloqueos.length})</h2>
            {vista.bloqueos.length === 0 && <p className="muted">Sin bloqueos.</p>}
            <ul>
              {vista.bloqueos.map((b, i) => (
                <li key={i} className="small">{b}</li>
              ))}
            </ul>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Aprendizajes ({vista.aprendizajes.length})</h2>
            {vista.aprendizajes.length === 0 && <p className="muted">Aún no hay aprendizajes.</p>}
            <ul>
              {vista.aprendizajes.map((a, i) => (
                <li key={i} className="small">
                  {a.conclusion} {a.reutilizable && <span className="chip">reutilizable</span>}
                </li>
              ))}
            </ul>
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
