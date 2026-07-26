'use client';

/**
 * Director Workspace (F2-DISC-02, integrado con la captura real F2-DISC-03).
 * Flujo deliberativo (§4): Comprensión → Transparencia → Candidatos → Impacto → Decisión.
 * La comprensión proviene de la EVALUACIÓN REAL del Director (no de un caso sembrado).
 * Divulgación progresiva auditable (ADR-0017): cada afirmación es navegable hasta su
 * evidencia original. La página NO interpreta: organiza lo que producen los motores.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  decidirWorkspace,
  obtenerWorkspace,
  revocarWorkspace,
} from '../../lib/director-workspace-client';
import type {
  Candidato,
  CategoriaJustificacion,
  WorkspaceEstado,
} from '../../lib/director-workspace-types';

const TONO_CONF: Record<string, string> = { HIGH: 'ok', MEDIUM: 'warn', LOW: 'danger' };
const TONO_REGISTRO: Record<string, string> = {
  VIGENTE: 'ok',
  SUPERADA: 'reserved',
  REVOCADA: 'warn',
  RECHAZADA: 'danger',
};
const CATEGORIAS: CategoriaJustificacion[] = [
  'NEGOCIO',
  'PRESUPUESTO',
  'RIESGO',
  'REGULATORIO',
  'PRIORIDAD',
  'OTRO',
];

function fecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL');
  } catch {
    return iso;
  }
}

function nuevoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Nivel 4 — evidencia original: Objetivo → Mapeo → Señal → Hecho → Respuesta. */
function TrazabilidadCandidato({ c }: { c: Candidato }) {
  return (
    <div className="traza small">
      {c.trazabilidad.cadena.map((paso) => (
        <div key={paso.mapeoId} className="card" style={{ marginBottom: 6 }}>
          <div>
            <strong>{c.objetivoId}</strong> ← <code>{paso.mapeoId}</code> ← señal{' '}
            <code>{paso.senal.id}</code> <span className="chip">{paso.senal.nombre}</span>
          </div>
          <div className="muted">{paso.porque}</div>
          {paso.hecho && (
            <div>
              Hecho: «{paso.hecho.enunciado}»{' '}
              {paso.hecho.valor !== null && (
                <span className="chip">valor {String(paso.hecho.valor)}</span>
              )}{' '}
              <span className="muted">(pregunta: {paso.hecho.preguntaId})</span>
            </div>
          )}
          {paso.respuestaOriginal && (
            <div className="muted">
              Respuesta original ({paso.respuestaOriginal.tipo}): {paso.respuestaOriginal.detalle}
            </div>
          )}
        </div>
      ))}
      <div className="muted">
        Entradas del rubro utilizadas:{' '}
        {c.trazabilidad.entradasRubro.map((e) => (
          <code key={e} style={{ marginRight: 4 }}>
            {e}
          </code>
        ))}
      </div>
    </div>
  );
}

function CandidatoCard({
  c,
  seleccionado,
  onSeleccionar,
}: {
  c: Candidato;
  seleccionado: boolean;
  onSeleccionar: () => void;
}) {
  const tono = TONO_CONF[c.confianza] ?? 'reserved';
  return (
    <section
      className="card"
      style={seleccionado ? { outline: '2px solid var(--acento, #2563eb)' } : undefined}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
      >
        <div>
          <label style={{ cursor: 'pointer' }}>
            <input type="radio" name="candidato" checked={seleccionado} onChange={onSeleccionar} />{' '}
            <strong>{c.objetivo}</strong>
          </label>
          <div className="small muted">
            {c.objetivoId} · métrica: {c.metrica}
            {c.costoMedicion ? ` · medición: ${c.costoMedicion}` : ''}
          </div>
        </div>
        <span className={`badge badge--${tono}`}>confianza {c.confianzaTexto}</span>
      </div>

      <details open>
        <summary>¿Por qué SOEC propone esto?</summary>
        <ul className="limpia small">
          <li>
            <strong>Detecté:</strong> {c.explicacion.detecte}
          </li>
          <li>
            <strong>Observé:</strong> {c.explicacion.observe}
          </li>
          <li>
            <strong>Necesito:</strong> {c.explicacion.necesito}
          </li>
          <li>
            <strong>Me falta:</strong> {c.explicacion.meFalta}
          </li>
        </ul>
      </details>

      <details>
        <summary>Alternativas (estrategias) · {c.estrategiasSugeridas.length}</summary>
        <ul className="limpia small">
          {c.estrategiasSugeridas.map((e) => (
            <li key={e.id}>
              <code>{e.id}</code> {e.estrategia}{' '}
              {e.bloqueada && <span className="badge badge--danger">bloqueada</span>}
            </li>
          ))}
        </ul>
      </details>

      {c.advertenciasRegulatorias.length > 0 && (
        <details>
          <summary>Implicancias regulatorias · {c.advertenciasRegulatorias.length}</summary>
          <ul className="limpia small">
            {c.advertenciasRegulatorias.map((a, i) => (
              <li key={i}>
                <span className={`badge badge--${a.efecto === 'BLOQUEA' ? 'danger' : 'warn'}`}>
                  {a.efecto}
                </span>{' '}
                <code>{a.reglaId}</code> sobre <code>{a.estrategiaId}</code> (activada por{' '}
                {a.activadaPor}) — {a.nota}{' '}
                <span className="chip">{a.estado} · no certifica cumplimiento</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details>
        <summary>
          Factores de confianza (evidencia · faltantes · contradicciones · supuestos)
        </summary>
        <div className="small">
          <p>
            <strong>Hechos que respaldan:</strong>{' '}
            {c.factoresConfianza.hechosRespaldatorios.join(', ') || '—'}
          </p>
          <p>
            <strong>Faltantes que reducen:</strong>{' '}
            {c.factoresConfianza.faltantesQueReducen.join(', ') || '—'}
          </p>
          <p>
            <strong>Contradicciones que reducen:</strong>{' '}
            {c.factoresConfianza.contradiccionesQueReducen.join(', ') || '—'}
          </p>
          <p>
            <strong>Supuestos utilizados:</strong>{' '}
            {c.factoresConfianza.supuestosUtilizados.join(', ') || '—'}
          </p>
        </div>
      </details>

      <details>
        <summary>
          Trazabilidad completa: Objetivo → Mapeo → Señal → Hecho → Respuesta original
        </summary>
        <TrazabilidadCandidato c={c} />
      </details>

      <div className="small" style={{ marginTop: 6 }}>
        <div className="muted">Si acepto → {c.impacto.siAcepto}</div>
        <div className="muted">Si rechazo → {c.impacto.siRechazo}</div>
      </div>
    </section>
  );
}

export default function DirectorWorkspacePage() {
  const [org, setOrg] = useState('');
  const [dep, setDep] = useState('');
  const [evaluacionId, setEvaluacionId] = useState('');
  const [listo, setListo] = useState(false);
  const [w, setW] = useState<WorkspaceEstado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [objetivoSel, setObjetivoSel] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState<CategoriaJustificacion>('NEGOCIO');
  const [aviso, setAviso] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState(false);

  // Lee org/departamento/evaluacionId de la URL (cliente) una sola vez.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setOrg(p.get('org') || '');
    setDep(p.get('departamento') || '');
    setEvaluacionId(p.get('evaluacionId') || '');
    setListo(true);
  }, []);

  const refrescar = useCallback(async () => {
    if (!org || !dep || !evaluacionId) return;
    try {
      const r = await obtenerWorkspace(org, dep, evaluacionId);
      setW(r);
      setError(null);
      if (r.candidatos[0]) setObjetivoSel((prev) => prev ?? r.candidatos[0]!.objetivoId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [org, dep, evaluacionId]);

  useEffect(() => {
    if (listo) void refrescar();
  }, [listo, refrescar]);

  const candidatoSel = useMemo(
    () => w?.candidatos.find((c) => c.objetivoId === objetivoSel) ?? null,
    [w, objetivoSel],
  );

  const registrar = useCallback(
    async (resultado: 'ACEPTADO' | 'RECHAZADO') => {
      if (!w) return;
      if (texto.trim() === '') {
        setAviso('Escribe una justificación antes de registrar la decisión.');
        return;
      }
      if (resultado === 'ACEPTADO' && !objetivoSel) {
        setAviso('Selecciona un objetivo para aceptar.');
        return;
      }
      setOcupado(true);
      setAviso(null);
      try {
        const r = await decidirWorkspace({
          org,
          departamento: dep,
          evaluacionId,
          decisionId: nuevoId(),
          resultado,
          objetivoId: resultado === 'ACEPTADO' ? objetivoSel : null,
          justificacion: { texto: texto.trim(), categoria },
        });
        setW(r);
        setTexto('');
        setCerrado(false);
        setAviso(
          resultado === 'ACEPTADO'
            ? 'Decisión registrada: objetivo vigente actualizado. No se ejecutó ninguna acción.'
            : 'Rechazo registrado. El objetivo vigente no cambió.',
        );
      } catch (e) {
        setAviso(`No se pudo registrar: ${(e as Error).message}`);
      } finally {
        setOcupado(false);
      }
    },
    [w, texto, categoria, objetivoSel, org, dep, evaluacionId],
  );

  const cerrar = useCallback(() => {
    setCerrado(true);
    setAviso('Cerraste sin registrar ninguna decisión. No se emitió ningún evento.');
  }, []);

  const revocar = useCallback(async () => {
    if (!w?.gobierno.vigente) return;
    setOcupado(true);
    try {
      const r = await revocarWorkspace(
        org,
        dep,
        evaluacionId,
        w.gobierno.vigente.decisionId,
        'revocada por el Director desde el Workspace',
      );
      setW(r);
      setAviso('Objetivo vigente revocado. El departamento queda sin objetivo vigente.');
    } catch (e) {
      setAviso(`No se pudo revocar: ${(e as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }, [w, org, dep, evaluacionId]);

  if (error) {
    return (
      <div>
        <h1>Director Workspace</h1>
        <section className="card">
          <strong>No se pudo cargar el Workspace.</strong>
          <p className="small muted">{error}</p>
        </section>
      </div>
    );
  }
  if (listo && (!org || !dep || !evaluacionId)) {
    return (
      <div>
        <h1>Director Workspace</h1>
        <section className="card">
          <strong>Selecciona una evaluación para gobernar.</strong>
          <p className="small">
            El Workspace gobierna una evaluación identificada. Elige o inicia una desde la
            evaluación del Director.
          </p>
          <Link className="btn" href="/evaluacion">
            Ir a la evaluación
          </Link>
        </section>
      </div>
    );
  }
  if (!w) {
    return (
      <div>
        <h1>Director Workspace</h1>
        <section className="card">
          <span className="spinner" /> Componiendo el estado del departamento…
        </section>
      </div>
    );
  }

  const v = w.gobierno.vigente;
  const enlaceEval = `/evaluacion?org=${encodeURIComponent(org)}&departamento=${encodeURIComponent(dep)}&evaluacionId=${encodeURIComponent(evaluacionId)}`;

  return (
    <div>
      <h1>
        Director Workspace — {dep} <span className="small muted">· {org}</span>
      </h1>
      <p className="muted">
        La comprensión proviene de la evaluación real del Director. SOEC comprende, explica y
        propone; la decisión y su justificación son de la persona. Aquí se gobierna un departamento
        sin ejecutar nada sobre el negocio. <Link href={enlaceEval}>Ir a la evaluación</Link>.
      </p>

      <section className="card">
        <div className="kv">
          <dt>Objetivo vigente</dt>
          <dd>
            {v ? (
              <>
                <span className="badge badge--ok">VIGENTE</span> <strong>{v.objetivo}</strong>{' '}
                <span className="muted">
                  ({v.objetivoId}, desde {fecha(v.en)})
                </span>{' '}
                <button className="btn btn--sec" disabled={ocupado} onClick={revocar}>
                  Revocar
                </button>
              </>
            ) : (
              <span className="muted">Ningún objetivo vigente en este departamento.</span>
            )}
          </dd>
          {w.generacion && (
            <>
              <dt>Comprensión</dt>
              <dd className="small muted">
                generación <code>{w.generacion.generacionId.slice(0, 8)}</code> · huella{' '}
                <code>{w.generacion.huella.slice(0, 12)}</code>
              </dd>
            </>
          )}
        </div>
      </section>

      {aviso && (
        <section className="card">
          <strong>{aviso}</strong>
        </section>
      )}

      {w.sinEvaluacion ? (
        <section className="card">
          <strong>Aún no hay una comprensión generada para este departamento.</strong>
          <p className="small">
            {w.tieneRespuestas
              ? 'Ya hay respuestas capturadas: vuelve a la evaluación y genera la comprensión.'
              : 'Inicia la evaluación del Director para capturar las respuestas y generar la comprensión.'}
          </p>
          <Link className="btn" href={enlaceEval}>
            {w.tieneRespuestas ? 'Continuar la evaluación' : 'Iniciar la evaluación'}
          </Link>
          {v && (
            <p className="small muted" style={{ marginTop: 8 }}>
              El objetivo vigente actual y el historial provienen de decisiones anteriores; su
              procedencia (instantánea congelada) se conserva intacta aunque la evaluación cambie.
            </p>
          )}
        </section>
      ) : (
        <>
          <h2>1 · Comprensión — ¿qué entendió SOEC?</h2>
          <section className="card">
            <h3 className="small">Hechos comprendidos ({w.comprension.hechos.length})</h3>
            <ul className="limpia small">
              {w.comprension.hechos.map((h) => (
                <li key={h.preguntaId}>
                  <strong>{h.enunciado}</strong>{' '}
                  {h.valor !== null && h.valor !== undefined && (
                    <span className="chip">valor {String(h.valor)}</span>
                  )}{' '}
                  <span className="muted">({h.preguntaId})</span>
                </li>
              ))}
            </ul>
            <h3 className="small">Lo que falta ({w.comprension.faltantes.length})</h3>
            <ul className="limpia small">
              {w.comprension.faltantes.map((f) => (
                <li key={f.preguntaId}>
                  <span className="badge badge--warn">{f.motivo}</span> {f.mensaje}{' '}
                  <span className="muted">({f.preguntaId})</span>
                </li>
              ))}
              {w.comprension.faltantes.length === 0 && (
                <li className="muted">Sin faltantes registrados.</li>
              )}
            </ul>
            {w.comprension.contradicciones.length > 0 && (
              <>
                <h3 className="small">
                  Contradicciones abiertas ({w.comprension.contradicciones.length})
                </h3>
                <ul className="limpia small">
                  {w.comprension.contradicciones.map((c) => (
                    <li key={c.preguntaId}>
                      <span className="badge badge--danger">contradicción</span> {c.preguntaId}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <h2>Transparencia — ¿qué NO sabe SOEC?</h2>
          <section className="card">
            <div className="kv">
              <dt>Confianza global</dt>
              <dd>{w.transparencia.confianzaGlobal}</dd>
              <dt>Incertidumbre declarada</dt>
              <dd>{w.transparencia.incertidumbre}</dd>
            </div>
            <h3 className="small">Supuestos del rubro en uso</h3>
            <ul className="limpia small">
              {w.transparencia.supuestos.map((s) => (
                <li key={s.id}>
                  <code>{s.id}</code> {s.texto}
                </li>
              ))}
            </ul>
            <h3 className="small">Próximos datos más valiosos</h3>
            <ul className="limpia small">
              {w.transparencia.proximosDatosMasValiosos.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {w.transparencia.proximosDatosMasValiosos.length === 0 && (
                <li className="muted">No hay datos pendientes que reduzcan la incertidumbre.</li>
              )}
            </ul>
          </section>

          <h2>2 · Candidatos — objetivos propuestos y su fundamento</h2>
          {!w.propuestaDisponible ? (
            <section className="card">
              <strong>SOEC se abstiene de proponer.</strong>
              <p className="small">{w.abstencion?.razon}</p>
              {w.abstencion && w.abstencion.faltantesRelevantes.length > 0 && (
                <p className="small muted">
                  Faltantes relevantes: {w.abstencion.faltantesRelevantes.join(', ')}
                </p>
              )}
            </section>
          ) : (
            <>
              {w.cobertura && (
                <p className="small muted">
                  Cobertura: {w.cobertura.candidatosFundados} de {w.cobertura.candidatosEsperados}{' '}
                  candidatos fundados
                  {w.cobertura.motivoDeCoberturaParcial
                    ? ` — ${w.cobertura.motivoDeCoberturaParcial}`
                    : ''}
                  .
                </p>
              )}
              {w.candidatos.map((c) => (
                <CandidatoCard
                  key={c.objetivoId}
                  c={c}
                  seleccionado={objetivoSel === c.objetivoId}
                  onSeleccionar={() => setObjetivoSel(c.objetivoId)}
                />
              ))}
            </>
          )}

          {candidatoSel && (
            <>
              <h2>3 · Impacto — ¿qué ocurre si decido?</h2>
              <section className="card small">
                <p>
                  Objetivo seleccionado: <strong>{candidatoSel.objetivo}</strong>
                </p>
                <p className="muted">Si acepto → {candidatoSel.impacto.siAcepto}</p>
                <p className="muted">Si rechazo → {candidatoSel.impacto.siRechazo}</p>
              </section>
            </>
          )}

          <h2>4 · Decisión</h2>
          <section className="card">
            {cerrado && (
              <p className="small">
                <strong>Cerrado sin registrar.</strong> No se emitió ningún evento.
              </p>
            )}
            <label className="small">Justificación (obligatoria)</label>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: 70 }}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="¿Por qué tomas esta decisión?"
            />
            <div style={{ margin: '8px 0' }}>
              <label className="small">Categoría: </label>{' '}
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as CategoriaJustificacion)}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button
                className="btn"
                disabled={ocupado || !w.propuestaDisponible || !objetivoSel}
                onClick={() => registrar('ACEPTADO')}
              >
                Aceptar el objetivo seleccionado
              </button>{' '}
              <button
                className="btn btn--sec"
                disabled={ocupado}
                onClick={() => registrar('RECHAZADO')}
              >
                Rechazar la propuesta
              </button>{' '}
              <button className="btn btn--sec" disabled={ocupado} onClick={cerrar}>
                Cerrar sin registrar
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Decidir ≠ ejecutar. Aceptar deja el objetivo <strong>vigente</strong>; la Preparación
              (aún no construida) lo convertirá luego en un plan. Ningún efecto real ocurre aquí.
            </p>
          </section>
        </>
      )}

      <h2>Historial de decisiones</h2>
      <section className="card">
        <ul className="limpia small">
          {w.gobierno.historial.map((d) => (
            <li key={d.decisionId}>
              <span className={`badge badge--${TONO_REGISTRO[d.estadoRegistro] ?? 'reserved'}`}>
                {d.estadoRegistro}
              </span>{' '}
              {d.resultado}
              {d.objetivo ? ` · ${d.objetivo}` : ''} <span className="chip">{d.categoria}</span>{' '}
              <span className="muted">{fecha(d.en)}</span>
              <div className="muted">«{d.justificacion}»</div>
            </li>
          ))}
          {w.gobierno.historial.length === 0 && (
            <li className="muted">Sin decisiones registradas todavía.</li>
          )}
        </ul>
      </section>

      <p className="small muted" style={{ marginTop: 14 }}>
        Auditabilidad: cada decisión congela la propuesta completa (comprensión + estrategia +
        candidato + huella). Toda conclusión de esta pantalla es navegable, sin saltos, hasta la
        respuesta original y el conocimiento del rubro.
      </p>
    </div>
  );
}
