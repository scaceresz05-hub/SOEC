'use client';

/**
 * Evaluación del Director (F2-DISC-03 · F2-PILOT-00). Selección GOBERNADA (catálogo, sin
 * texto libre) → lista de evaluaciones existentes o nueva → captura durable identificada.
 * Estados por pregunta; normalización segura; advertencia honesta al generar sin evidencia.
 * Sin efectos operativos.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  cerrarEvaluacion,
  generarEvaluacion,
  iniciarEvaluacion,
  listarEvaluaciones,
  obtenerCatalogo,
  obtenerEvaluacion,
  responderEvaluacion,
} from '../../lib/evaluacion-client';
import type {
  Catalogo,
  EntradaRespuesta,
  EvaluacionEstado,
  PreguntaEval,
  ResumenEvaluacion,
} from '../../lib/evaluacion-types';
import { esParValido, reconciliar } from '../../lib/seleccion';

const TONO_ESTADO_RESP: Record<string, string> = {
  RESPONDIDA: 'ok',
  SIN_RESPONDER: 'reserved',
  CONTRADICTORIA: 'danger',
  NO_NORMALIZABLE: 'warn',
};
const TONO_ESTADO_EVAL: Record<string, string> = {
  BORRADOR: 'reserved',
  GENERADA: 'ok',
  CERRADA: 'warn',
  ARCHIVADA: 'danger',
};

function resumenEntrada(p: PreguntaEval): string {
  const e = p.entrada;
  if (!e) return 'sin respuesta';
  switch (e.clase) {
    case 'ABIERTA':
      return `«${e.texto}»`;
    case 'CERRADA':
      return `valor ingresado: «${e.valorCrudo}»${p.valorNormalizado !== null ? ` → ${p.valorNormalizado ? 'Sí' : 'No'}` : ' → no normalizable'}`;
    case 'CONTRADICCION':
      return `a favor: «${e.aFavor}» / en contra: «${e.enContra}»`;
    case 'SIN_INFORMACION':
      return 'sin información (declarado)';
  }
}

function PreguntaFila({
  p,
  editable,
  ocupado,
  onResponder,
}: {
  p: PreguntaEval;
  editable: boolean;
  ocupado: boolean;
  onResponder: (preguntaId: string, entrada: EntradaRespuesta) => Promise<void>;
}) {
  const [texto, setTexto] = useState(p.entrada?.clase === 'ABIERTA' ? p.entrada.texto : '');
  const [sustento, setSustento] = useState(
    p.entrada?.clase === 'ABIERTA' ? (p.entrada.sustento ?? '') : '',
  );
  const [libre, setLibre] = useState(p.entrada?.clase === 'CERRADA' ? p.entrada.valorCrudo : '');
  const [contra, setContra] = useState(false);
  const [aFavor, setAFavor] = useState(
    p.entrada?.clase === 'CONTRADICCION' ? p.entrada.aFavor : '',
  );
  const [enContra, setEnContra] = useState(
    p.entrada?.clase === 'CONTRADICCION' ? p.entrada.enContra : '',
  );
  const dis = ocupado || !editable;

  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{p.preguntaId}</strong>
        <span className={`badge badge--${TONO_ESTADO_RESP[p.estado] ?? 'reserved'}`}>
          {p.estado}
        </span>
      </div>
      <div className="small muted">
        {p.tipo === 'CERRADA_BOOLEAN'
          ? `pregunta cerrada (señal ${p.senalNombre})`
          : 'pregunta abierta'}{' '}
        · {resumenEntrada(p)}
      </div>

      {p.tipo === 'CERRADA_BOOLEAN' ? (
        <div style={{ marginTop: 6 }}>
          <button
            className="btn btn--sec"
            disabled={dis}
            onClick={() => onResponder(p.preguntaId, { clase: 'CERRADA', valorCrudo: 'sí' })}
          >
            Sí
          </button>{' '}
          <button
            className="btn btn--sec"
            disabled={dis}
            onClick={() => onResponder(p.preguntaId, { clase: 'CERRADA', valorCrudo: 'no' })}
          >
            No
          </button>{' '}
          <button
            className="btn btn--sec"
            disabled={dis}
            onClick={() => onResponder(p.preguntaId, { clase: 'SIN_INFORMACION' })}
          >
            No lo sé
          </button>
          <div className="small" style={{ marginTop: 6 }}>
            <label className="muted">o escribe tu respuesta: </label>
            <input
              value={libre}
              onChange={(e) => setLibre(e.target.value)}
              placeholder="p. ej. «a veces»"
              disabled={dis}
            />{' '}
            <button
              className="btn btn--sec"
              disabled={dis || libre.trim() === ''}
              onClick={() => onResponder(p.preguntaId, { clase: 'CERRADA', valorCrudo: libre })}
            >
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {!contra ? (
            <>
              <textarea
                className="input"
                style={{ width: '100%', minHeight: 48 }}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Tu respuesta…"
                disabled={dis}
              />
              <input
                value={sustento}
                onChange={(e) => setSustento(e.target.value)}
                placeholder="sustento (opcional)"
                style={{ width: '100%', marginTop: 4 }}
                disabled={dis}
              />
              <div style={{ marginTop: 6 }}>
                <button
                  className="btn btn--sec"
                  disabled={dis || texto.trim() === ''}
                  onClick={() =>
                    onResponder(
                      p.preguntaId,
                      sustento.trim()
                        ? { clase: 'ABIERTA', texto, sustento }
                        : { clase: 'ABIERTA', texto },
                    )
                  }
                >
                  Guardar
                </button>{' '}
                <button
                  className="btn btn--sec"
                  disabled={dis}
                  onClick={() => onResponder(p.preguntaId, { clase: 'SIN_INFORMACION' })}
                >
                  Sin información
                </button>{' '}
                <button className="btn btn--sec" disabled={dis} onClick={() => setContra(true)}>
                  Marcar contradicción
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                value={aFavor}
                onChange={(e) => setAFavor(e.target.value)}
                placeholder="evidencia a favor"
                style={{ width: '100%' }}
                disabled={dis}
              />
              <input
                value={enContra}
                onChange={(e) => setEnContra(e.target.value)}
                placeholder="evidencia en contra"
                style={{ width: '100%', marginTop: 4 }}
                disabled={dis}
              />
              <div style={{ marginTop: 6 }}>
                <button
                  className="btn btn--sec"
                  disabled={dis || aFavor.trim() === '' || enContra.trim() === ''}
                  onClick={() =>
                    onResponder(p.preguntaId, { clase: 'CONTRADICCION', aFavor, enContra })
                  }
                >
                  Guardar contradicción
                </button>{' '}
                <button className="btn btn--sec" disabled={dis} onClick={() => setContra(false)}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function EvaluacionPage() {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [org, setOrg] = useState('');
  const [dep, setDep] = useState('');
  const [evaluacionId, setEvaluacionId] = useState<string | null>(null);
  const [lista, setLista] = useState<ResumenEvaluacion[]>([]);
  const [titulo, setTitulo] = useState('');
  const [e, setE] = useState<EvaluacionEstado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [advertir, setAdvertir] = useState(false);
  const [listo, setListo] = useState(false);

  const departamentos = cat?.organizaciones.find((o) => o.id === org)?.departamentos ?? [];

  function urlDe(o: string, d: string, ev: string | null) {
    const p = new URLSearchParams({ org: o, departamento: d });
    if (ev) p.set('evaluacionId', ev);
    return `/evaluacion?${p.toString()}`;
  }
  const sincronizarUrl = useCallback((o: string, d: string, ev: string | null) => {
    window.history.replaceState(null, '', urlDe(o, d, ev));
  }, []);

  // Carga inicial: catálogo + reconciliación de los parámetros de la URL contra el catálogo.
  useEffect(() => {
    (async () => {
      const c = await obtenerCatalogo();
      const p = new URLSearchParams(window.location.search);
      const rec = reconciliar(c, p.get('org'), p.get('departamento'));
      // Si el par de la URL era inválido/obsoleto, el evaluacionId (ligado a ese par) ya no aplica.
      const ev = rec.reconciliado ? null : p.get('evaluacionId');
      setCat(c);
      setOrg(rec.org);
      setDep(rec.dep);
      setEvaluacionId(ev);
      setListo(true);
      // Limpiar la URL al par gobernado (replace: sin entrada de historial), evitando que un
      // enlace antiguo deje el <select> con un value sin opción coincidente.
      if (rec.reconciliado || p.get('org') !== rec.org || p.get('departamento') !== rec.dep) {
        window.history.replaceState(null, '', urlDe(rec.org, rec.dep, ev));
      }
    })();
  }, []);

  // Integridad: la acción solo procede con un par (org, departamento) del catálogo gobernado.
  const seleccionValida = esParValido(cat, org, dep);

  const refrescarLista = useCallback(async (o: string, d: string) => {
    if (!o || !d) return;
    setLista((await listarEvaluaciones(o, d)).evaluaciones);
  }, []);

  const cargarEvaluacion = useCallback(async (o: string, d: string, ev: string) => {
    setE(await obtenerEvaluacion(o, d, ev));
  }, []);

  useEffect(() => {
    if (!listo) return;
    if (evaluacionId) void cargarEvaluacion(org, dep, evaluacionId);
    else void refrescarLista(org, dep);
  }, [listo, evaluacionId, org, dep, cargarEvaluacion, refrescarLista]);

  const seleccionarOrg = useCallback(
    (o: string) => {
      const d = cat?.organizaciones.find((x) => x.id === o)?.departamentos[0]?.id ?? '';
      setOrg(o);
      setDep(d);
      setEvaluacionId(null);
      setE(null);
      sincronizarUrl(o, d, null);
    },
    [cat, sincronizarUrl],
  );

  const nueva = useCallback(async () => {
    // Defensa en profundidad: nunca enviar una solicitud condenada a 400.
    if (!seleccionValida) {
      setAviso('Selecciona una organización y un departamento válidos.');
      return;
    }
    setOcupado(true);
    setAviso(null);
    try {
      const r = await iniciarEvaluacion(org, dep, titulo.trim() || 'Evaluación');
      setTitulo('');
      setEvaluacionId(r.evaluacionId);
      setE(r);
      sincronizarUrl(org, dep, r.evaluacionId);
    } catch (err) {
      setAviso(`No se pudo iniciar: ${(err as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }, [org, dep, titulo, sincronizarUrl, seleccionValida]);

  const abrir = useCallback(
    (ev: string) => {
      setEvaluacionId(ev);
      sincronizarUrl(org, dep, ev);
    },
    [org, dep, sincronizarUrl],
  );

  const volver = useCallback(() => {
    setEvaluacionId(null);
    setE(null);
    setAdvertir(false);
    sincronizarUrl(org, dep, null);
    void refrescarLista(org, dep);
  }, [org, dep, sincronizarUrl, refrescarLista]);

  const responder = useCallback(
    async (preguntaId: string, entrada: EntradaRespuesta) => {
      if (!evaluacionId) return;
      setOcupado(true);
      setAviso(null);
      try {
        setE(await responderEvaluacion(org, dep, evaluacionId, preguntaId, entrada));
      } catch (err) {
        setAviso(`No se pudo guardar: ${(err as Error).message}`);
      } finally {
        setOcupado(false);
      }
    },
    [org, dep, evaluacionId],
  );

  const generar = useCallback(async () => {
    if (!evaluacionId) return;
    if (e?.generacionSinEvidencia && !advertir) {
      setAdvertir(true);
      return;
    }
    setOcupado(true);
    setAviso(null);
    setAdvertir(false);
    try {
      const r = await generarEvaluacion(org, dep, evaluacionId);
      setE(r);
      setAviso('Comprensión generada. Ya puedes gobernar en el Director Workspace.');
    } catch (err) {
      setAviso(`No se pudo generar: ${(err as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }, [org, dep, evaluacionId, e, advertir]);

  const cerrar = useCallback(async () => {
    if (!evaluacionId) return;
    setOcupado(true);
    try {
      setE(await cerrarEvaluacion(org, dep, evaluacionId));
      setAviso('Evaluación cerrada. Ya no admite cambios.');
    } finally {
      setOcupado(false);
    }
  }, [org, dep, evaluacionId]);

  const enlaceWs = evaluacionId
    ? `/director-workspace?org=${encodeURIComponent(org)}&departamento=${encodeURIComponent(dep)}&evaluacionId=${encodeURIComponent(evaluacionId)}`
    : '#';

  if (!cat) {
    return (
      <div>
        <h1>Evaluación del Director</h1>
        <section className="card">
          <span className="spinner" /> Cargando catálogo…
        </section>
      </div>
    );
  }

  return (
    <div>
      <h1>Evaluación del Director</h1>
      <p className="muted">
        Elige una organización y un departamento, inicia o reanuda una evaluación, y responde el
        cuestionario del rubro (generado desde el conocimiento gobernado). Cada respuesta se guarda
        al instante. Sin efectos operativos.
      </p>

      <section className="card">
        <div
          className="small"
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span>
            <label>Organización </label>
            <select
              value={org}
              onChange={(ev) => seleccionarOrg(ev.target.value)}
              disabled={ocupado}
            >
              {cat.organizaciones.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </span>
          <span>
            <label>Departamento </label>
            <select
              value={dep}
              onChange={(ev) => {
                setDep(ev.target.value);
                setEvaluacionId(null);
                setE(null);
                sincronizarUrl(org, ev.target.value, null);
              }}
              disabled={ocupado}
            >
              {departamentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </span>
          {evaluacionId && (
            <button className="btn btn--sec" onClick={volver} disabled={ocupado}>
              ← Volver a la lista
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {cat.organizaciones.find((o) => o.id === org)?.descripcion}
        </p>
      </section>

      {aviso && (
        <section className="card">
          <strong>{aviso}</strong>{' '}
          {e?.tieneGeneracion && evaluacionId && (
            <Link className="btn" href={enlaceWs}>
              Ir al Director Workspace
            </Link>
          )}
        </section>
      )}

      {!evaluacionId ? (
        <>
          <h2>Evaluaciones de este departamento</h2>
          <section className="card">
            {lista.length === 0 ? (
              <p className="muted">Aún no hay evaluaciones. Inicia una nueva.</p>
            ) : (
              <ul className="limpia small">
                {lista.map((l) => (
                  <li key={l.evaluacionId} style={{ marginBottom: 6 }}>
                    <span className={`badge badge--${TONO_ESTADO_EVAL[l.estado] ?? 'reserved'}`}>
                      {l.estado}
                    </span>{' '}
                    <strong>{l.titulo ?? 'Evaluación'}</strong>{' '}
                    <span className="muted">
                      · {l.respondidas} respondidas{l.tieneGeneracion ? ' · con comprensión' : ''}
                    </span>{' '}
                    <button className="btn btn--sec" onClick={() => abrir(l.evaluacionId)}>
                      Reanudar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <label className="small">Título de la nueva evaluación </label>
            <input
              value={titulo}
              onChange={(ev) => setTitulo(ev.target.value)}
              placeholder="p. ej. Evaluación de marzo"
            />{' '}
            <button className="btn" onClick={nueva} disabled={ocupado || !seleccionValida}>
              Iniciar evaluación nueva
            </button>
            {!seleccionValida && (
              <p className="small muted" style={{ marginTop: 6 }}>
                Selecciona una organización y un departamento válidos.
              </p>
            )}
          </section>
        </>
      ) : e ? (
        <>
          <section className="card">
            <div className="kv">
              <dt>Evaluación</dt>
              <dd>
                <span className={`badge badge--${TONO_ESTADO_EVAL[e.estado] ?? 'reserved'}`}>
                  {e.estado}
                </span>{' '}
                <strong>{e.titulo}</strong>{' '}
                <span className="muted small">
                  · {e.rubroId} v{e.rubroVersion}
                </span>
              </dd>
              <dt>Progreso</dt>
              <dd className="small">
                {e.resumen.respondidas} respondidas · {e.resumen.sinResponder} sin responder ·{' '}
                {e.resumen.contradictorias} contradicciones · {e.resumen.noNormalizables} no
                normalizables (de {e.resumen.total})
              </dd>
              <dt>Comprensión</dt>
              <dd className="small">
                {e.tieneGeneracion ? (
                  <>
                    generada ({e.generaciones}){' '}
                    {e.ultimaGeneracion && <code>{e.ultimaGeneracion.huella.slice(0, 12)}</code>}
                  </>
                ) : (
                  <span className="muted">aún no generada</span>
                )}
              </dd>
            </div>
            {advertir && (
              <p className="small" style={{ marginTop: 6 }}>
                <span className="badge badge--warn">atención</span> La comprensión se generará{' '}
                <strong>sin respuestas útiles</strong> y probablemente producirá una abstención.
                Puedes hacerlo, pero no habrá candidatos fundados.
              </p>
            )}
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={generar} disabled={ocupado || !e.editable}>
                {advertir ? 'Generar de todos modos' : 'Generar comprensión'}
              </button>{' '}
              <Link className="btn btn--sec" href={enlaceWs}>
                Ir al Director Workspace
              </Link>{' '}
              {e.editable && (
                <button className="btn btn--sec" onClick={cerrar} disabled={ocupado}>
                  Cerrar evaluación
                </button>
              )}
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              Generar congela el conjunto de respuestas (con huella) para que la decisión sea
              auditable. Puedes corregir y volver a generar; las decisiones ya registradas conservan
              su procedencia.
            </p>
          </section>

          <h2>Cuestionario</h2>
          {e.preguntas.map((p) => (
            <PreguntaFila
              key={p.preguntaId}
              p={p}
              editable={e.editable}
              ocupado={ocupado}
              onResponder={responder}
            />
          ))}
        </>
      ) : (
        <section className="card">
          <span className="spinner" /> Cargando evaluación…
        </section>
      )}

      <p className="small muted" style={{ marginTop: 14 }}>
        Ningún efecto operativo ocurre aquí. Esto es comprensión y decisión; la Preparación y la
        Operación no forman parte de este recorrido.
      </p>
    </div>
  );
}
