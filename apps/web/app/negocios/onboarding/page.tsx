'use client';

/**
 * ASISTENTE DE INCORPORACIÓN — «cuéntanos de tu negocio».
 *
 * Una pregunta cada vez, en lenguaje de negocio, y sólo las que aplican. La interfaz es deliberadamente
 * tonta: recibe del servidor qué preguntar ahora (ya resueltas las ramas y lo que SOEC ya sabe) y se limita a
 * pintarlo. Así la conversación puede mejorar sin tocar este archivo.
 *
 * Reglas visibles para quien lo use:
 *  · se guarda solo: si cierras el navegador, vuelves donde estabas;
 *  · lo que leímos de tu sitio se marca como tal y hay que confirmarlo;
 *  · terminar el asistente NO autoriza gastar dinero ni tocar tus campañas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ETIQUETA_ESTADO_DOMINIO,
  NOMBRE_DOMINIO,
  NOMBRE_NIVEL,
  completarOnboarding,
  guardarPaso,
  leerOnboarding,
  revisarSitio,
  type PasoVista,
  type PreguntaVista,
  type VistaOnboarding,
} from '../../../lib/onboarding-client';

const campo = { width: '100%', padding: 10, fontSize: 16, boxSizing: 'border-box' as const };
const bloque = { display: 'block', marginBottom: 20 };
const etiquetaEstilo = { display: 'block', fontWeight: 600, marginBottom: 6 };

type Respuestas = Record<string, unknown>;

function valorInicial(p: PreguntaVista): unknown {
  if (p.valorActual !== null && p.valorActual !== undefined) return p.valorActual;
  return p.tipo === 'OPCIONES' ? [] : p.tipo === 'SI_NO' ? null : '';
}

export default function OnboardingPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaOnboarding | null>(null);
  const [pasoId, setPasoId] = useState<string | null>(null);
  const [respuestas, setRespuestas] = useState<Respuestas>({});
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const guardadoPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      const v = await leerOnboarding(o);
      setVista(v);
      setPasoId((prev) => prev ?? v.pasoActual ?? v.siguientePaso);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo abrir el asistente');
    }
  }, []);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  const paso: PasoVista | null = useMemo(
    () => vista?.pasos.find((p) => p.id === pasoId) ?? vista?.pasos.find((p) => p.id === vista.siguientePaso) ?? null,
    [vista, pasoId],
  );

  // Al cambiar de paso, las respuestas locales parten de lo que el servidor ya tiene. Se observa sólo el ID
  // del paso a propósito: reiniciar el formulario en cada refresco borraría lo que la persona está escribiendo.
  const idDelPaso = paso?.id ?? null;
  useEffect(() => {
    if (vista === null || idDelPaso === null) return;
    const actual = vista.pasos.find((p) => p.id === idDelPaso);
    if (actual === undefined) return;
    const inicial: Respuestas = {};
    for (const p of actual.preguntas) inicial[p.id] = valorInicial(p);
    setRespuestas(inicial);
  }, [idDelPaso]);

  const guardar = useCallback(
    async (avanzar: boolean): Promise<VistaOnboarding | null> => {
      if (org === null || paso === null) return null;
      const soloConValor = Object.fromEntries(
        Object.entries(respuestas).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)),
      );
      if (Object.keys(soloConValor).length === 0 && !avanzar) return null;
      const v = await guardarPaso(org, paso.id, soloConValor, avanzar);
      setVista(v);
      return v;
    },
    [org, paso, respuestas],
  );

  // GUARDADO AUTOMÁTICO: lo que escribes no se pierde aunque te vayas sin pulsar nada.
  useEffect(() => {
    if (org === null || paso === null || Object.keys(respuestas).length === 0) return;
    if (guardadoPendiente.current !== null) clearTimeout(guardadoPendiente.current);
    guardadoPendiente.current = setTimeout(() => {
      void guardar(false).catch(() => undefined);
    }, 1800);
    return () => {
      if (guardadoPendiente.current !== null) clearTimeout(guardadoPendiente.current);
    };
  }, [respuestas, org, paso, guardar]);

  async function conCarga(fn: () => Promise<void>): Promise<void> {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo guardar');
    } finally {
      setOcupado(false);
    }
  }

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Cuéntanos de tu negocio</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const indice = vista?.pasos.findIndex((p) => p.id === paso?.id) ?? 0;
  const anterior = indice > 0 ? vista?.pasos[indice - 1]?.id ?? null : null;
  const esResumen = paso?.id === 'resumen';

  return (
    <main className="wrap" style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px' }}>
      <p style={{ marginBottom: 8 }}><Link href="/negocios">← Mi panel</Link></p>
      <h1 style={{ marginBottom: 4, fontSize: 24 }}>Cuéntanos de tu negocio</h1>
      <p style={{ color: 'var(--muted, #666)', marginBottom: 16 }}>
        Con esto SOEC entiende tu empresa. Se guarda solo: puedes salir y continuar cuando quieras.
      </p>

      {vista !== null && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ height: 8, background: 'var(--borde, #eee)', borderRadius: 999 }}>
            <div style={{ height: 8, width: `${vista.progreso}%`, background: 'var(--acento, #06c)', borderRadius: 999, transition: 'width .3s' }} />
          </div>
          <p style={{ color: 'var(--muted, #666)', marginTop: 6, fontSize: 14 }}>
            {vista.progreso}% · paso {Math.min(indice + 1, vista.pasos.length)} de {vista.pasos.length}
          </p>
        </div>
      )}

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}
      {aviso !== null && <p style={{ color: '#0a7', marginBottom: 16 }}>{aviso}</p>}
      {(vista?.avisos ?? []).map((a) => (
        <p key={a} style={{ color: '#b26a00', marginBottom: 16 }}>{a}</p>
      ))}

      {paso !== null && (
        <section>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>{paso.titulo}</h2>
          <p style={{ color: 'var(--muted, #666)', marginBottom: 20 }}>{paso.descripcion}</p>

          {paso.preguntas.map((p) => (
            <div key={p.id} style={bloque}>
              <label htmlFor={p.id} style={etiquetaEstilo}>
                {p.etiqueta} {p.requerida ? '' : <span style={{ color: 'var(--muted, #888)', fontWeight: 400 }}>(opcional)</span>}
              </label>
              {p.ayuda !== null && <p style={{ color: 'var(--muted, #666)', margin: '0 0 8px', fontSize: 14 }}>{p.ayuda}</p>}
              {p.confirmacion === 'DISCOVERED' && (
                <p style={{ color: '#b26a00', margin: '0 0 8px', fontSize: 14 }}>
                  Esto lo leímos de tu sitio. Revísalo y corrígelo si no calza.
                </p>
              )}
              {p.procedencia === 'CONNECTOR' && (
                <p style={{ color: '#0a7', margin: '0 0 8px', fontSize: 14 }}>Ya está conectado ✓</p>
              )}

              {p.tipo === 'TEXTO' && (
                <input id={p.id} value={String(respuestas[p.id] ?? '')} onChange={(e) => setRespuestas({ ...respuestas, [p.id]: e.target.value })} style={campo} />
              )}
              {p.tipo === 'TEXTO_LARGO' && (
                <textarea id={p.id} rows={3} value={String(respuestas[p.id] ?? '')} onChange={(e) => setRespuestas({ ...respuestas, [p.id]: e.target.value })} style={campo} />
              )}
              {p.tipo === 'NUMERO' && (
                <input id={p.id} inputMode="decimal" value={String(respuestas[p.id] ?? '')} onChange={(e) => setRespuestas({ ...respuestas, [p.id]: e.target.value })} style={campo} />
              )}
              {p.tipo === 'OPCION' && (
                <select id={p.id} value={String(respuestas[p.id] ?? '')} onChange={(e) => setRespuestas({ ...respuestas, [p.id]: e.target.value })} style={campo}>
                  <option value="">Elige una…</option>
                  {p.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                </select>
              )}
              {p.tipo === 'OPCIONES' && (
                <div>
                  {p.opciones.map((o) => {
                    const actuales = Array.isArray(respuestas[p.id]) ? (respuestas[p.id] as string[]) : [];
                    const marcada = actuales.includes(o.valor);
                    return (
                      <label key={o.valor} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0' }}>
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() => setRespuestas({
                            ...respuestas,
                            [p.id]: marcada ? actuales.filter((x) => x !== o.valor) : [...actuales, o.valor],
                          })}
                          style={{ width: 20, height: 20 }}
                        />
                        <span>{o.etiqueta}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {p.tipo === 'SI_NO' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  {[{ v: true, t: 'Sí' }, { v: false, t: 'No' }].map((o) => (
                    <button
                      key={o.t}
                      type="button"
                      onClick={() => setRespuestas({ ...respuestas, [p.id]: o.v })}
                      className="btn"
                      style={{
                        padding: '10px 20px',
                        fontWeight: respuestas[p.id] === o.v ? 700 : 400,
                        borderWidth: respuestas[p.id] === o.v ? 2 : 1,
                      }}
                    >
                      {o.t}
                    </button>
                  ))}
                </div>
              )}

              {p.id === 'negocio.sitio' && String(respuestas[p.id] ?? '') !== '' && (
                <p style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={ocupado}
                    onClick={() => void conCarga(async () => {
                      const v = await revisarSitio(org, String(respuestas[p.id] ?? ''));
                      setVista(v);
                      setAviso(v.sitio?.estado === 'OK' ? 'Revisamos tu sitio. Abajo verás lo que encontramos.' : 'No pudimos leer tu sitio, pero puedes seguir.');
                    })}
                    style={{ padding: '8px 14px' }}
                  >
                    Revisar mi sitio
                  </button>
                </p>
              )}
            </div>
          ))}

          {esResumen && vista !== null && (
            <div>
              <div className="card" style={{ border: '1px solid var(--borde, #eee)', padding: 16, marginBottom: 16 }}>
                <h3 style={{ marginTop: 0 }}>SOEC ya entiende tu empresa</h3>
                <dl style={{ margin: 0 }}>
                  {[
                    ['Empresa', vista.resumen.empresa],
                    ['A qué se dedica', vista.resumen.aQueSeDedica ?? '—'],
                    ['Lo que vende', vista.resumen.oferta.join(', ') || '—'],
                    ['Objetivo', vista.resumen.objetivo ?? '—'],
                    ['Territorio', vista.resumen.territorio.join(', ') || '—'],
                    ['Cómo lo contactan', vista.resumen.conversiones.join(', ') || '—'],
                    ['Lo que no debemos decir', vista.resumen.restricciones.join(' · ') || '—'],
                    ['Fuentes de datos', vista.resumen.conexiones.map((c) => `${c.nombre} (${c.estado})`).join(', ') || '—'],
                    ['Máximo a invertir', vista.resumen.presupuestoMaximo],
                    ['Nivel de autonomía', vista.resumen.nivelDeAutonomia],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: '1px solid var(--borde, #f0f0f0)' }}>
                      <dt style={{ fontWeight: 600, minWidth: 150 }}>{k}</dt>
                      <dd style={{ margin: 0 }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <h3>Qué está listo</h3>
              {vista.readiness.dominios.map((d) => (
                <div key={d.dominio} style={{ padding: '8px 0', borderTop: '1px solid var(--borde, #f0f0f0)' }}>
                  <strong>{NOMBRE_DOMINIO[d.dominio] ?? d.dominio}</strong>{' '}
                  <span style={{ color: d.estado === 'COMPLETE' ? '#0a7' : d.estado === 'ACTION_REQUIRED' ? '#b00020' : '#b26a00' }}>
                    · {ETIQUETA_ESTADO_DOMINIO[d.estado]}
                  </span>
                  {d.motivos.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--muted, #666)' }}>
                      {d.motivos.map((m) => <li key={m.campo}>{m.comoSeResuelve}</li>)}
                    </ul>
                  )}
                </div>
              ))}

              <h3 style={{ marginTop: 24 }}>Hasta dónde puede llegar SOEC hoy</h3>
              {vista.readiness.niveles.map((n) => (
                <div key={n.nivel} style={{ padding: '8px 0', borderTop: '1px solid var(--borde, #f0f0f0)' }}>
                  <strong>{n.listo ? '✓' : '○'} {NOMBRE_NIVEL[n.nivel] ?? n.nivel}</strong>
                  {!n.listo && n.bloqueos.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--muted, #666)' }}>
                      {n.bloqueos.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  )}
                </div>
              ))}

              <p style={{ marginTop: 20, color: 'var(--muted, #666)' }}>
                Terminar aquí no gasta dinero ni cambia tus campañas. Cuando quieras invertir, se decide aparte
                en <Link href="/negocios/conexiones">Conexiones y permisos</Link>.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24 }}>
            {anterior !== null && (
              <button type="button" className="btn" disabled={ocupado} onClick={() => setPasoId(anterior)} style={{ padding: '12px 20px' }}>
                Atrás
              </button>
            )}
            {!esResumen && (
              <button
                type="button"
                className="btn primary"
                disabled={ocupado}
                onClick={() => void conCarga(async () => {
                  const v = await guardar(true);
                  if (v !== null) setPasoId(v.siguientePaso);
                })}
                style={{ padding: '12px 24px', fontWeight: 600 }}
              >
                Continuar
              </button>
            )}
            {esResumen && (
              <button
                type="button"
                className="btn primary"
                disabled={ocupado}
                onClick={() => void conCarga(async () => {
                  const v = await completarOnboarding(org);
                  setVista(v);
                  setAviso(v.estado === 'COMPLETE'
                    ? 'Listo. SOEC ya entiende tu empresa.'
                    : 'Guardado. Todavía falta algo: lo verás arriba.');
                })}
                style={{ padding: '12px 24px', fontWeight: 600 }}
              >
                Terminar
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={ocupado}
              onClick={() => void conCarga(async () => {
                await guardar(false);
                setAviso('Guardado. Puedes volver cuando quieras.');
              })}
              style={{ padding: '12px 20px' }}
            >
              Guardar y salir
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
