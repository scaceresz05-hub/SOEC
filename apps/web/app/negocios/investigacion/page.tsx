'use client';

/**
 * INVESTIGACIÓN DE MERCADO del negocio activo.
 *
 * Una sola acción del dueño — «investigar mi mercado» — y SOEC responde con lo que OBSERVÓ: de dónde salió cada
 * dato, qué demanda existe, qué canales tienen sentido hoy, qué territorio es alcanzable y qué páginas están
 * listas. Nada de esto publica ni gasta nada.
 *
 * Reglas de esta pantalla:
 *  · se muestra la PROCEDENCIA antes que la conclusión: fuente, fecha y si estuvo disponible o no;
 *  · una fuente caída se dice («no disponible» y por qué), no se rellena con cifras inventadas;
 *  · no se enseña GAQL, ni payloads, ni identificadores de la API de Google;
 *  · investigar cuesta cuota: si la investigación sigue fresca se reutiliza, y repetirla es un acto explícito.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ETIQUETA_DISPONIBILIDAD,
  ETIQUETA_INTENCION,
  ETIQUETA_LANDING,
  ETIQUETA_VEREDICTO,
  NOMBRE_CANAL,
  NOMBRE_FUENTE,
  investigar,
  leerInvestigacion,
  type VistaInvestigacion,
} from '../../../lib/investigacion-client';

const ESTADO_CORRIDA: Record<string, string> = {
  QUEUED: 'en espera',
  RUNNING: 'en marcha',
  PARTIAL: 'terminada con datos parciales',
  COMPLETE: 'terminada',
  FAILED: 'no se pudo completar',
  STALE: 'quedó vieja',
};

const COLOR_VEREDICTO: Record<string, string> = {
  SUITABLE: '#0a7',
  POSSIBLE: '#b58900',
  INSUFFICIENT_EVIDENCE: '#666',
  NOT_SUITABLE: '#b00020',
  BLOCKED: '#b00020',
};

const CONFIANZA: Record<string, string> = { HIGH: 'alta', MEDIUM: 'media', LOW: 'baja' };
const DERRAME: Record<string, string> = { HIGH: 'alto', MEDIUM: 'medio', LOW: 'bajo', NONE: 'ninguno' };

const fecha = (v: string | null): string => (v === null ? '—' : new Date(v).toLocaleString());
const seccion = { marginBottom: 32 } as const;
const titulo = { fontSize: 18, marginBottom: 8 } as const;
const apagado = { color: 'var(--muted, #666)' } as const;

export default function InvestigacionPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaInvestigacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      setVista(await leerInvestigacion(o));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo leer la investigación');
    }
  }, []);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  async function lanzar(forzar: boolean): Promise<void> {
    if (org === null) return;
    setOcupado(true);
    setError(null);
    try {
      setVista(await investigar(org, forzar));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'la investigación no se pudo iniciar');
    } finally {
      setOcupado(false);
    }
  }

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Investigación de mercado</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const corrida = vista?.corrida ?? null;
  const terminos = vista?.terminos ?? [];
  const candidatas = terminos.filter((t) => t.elegibilidad === 'CANDIDATE');
  const excluidas = terminos.filter((t) => t.elegibilidad === 'EXCLUDED');
  const revisar = terminos.filter((t) => t.elegibilidad === 'NEEDS_REVIEW');

  return (
    <main className="wrap" style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/negocios">← Volver al panel</Link>
        <Link href="/negocios/plan">Plan de marketing →</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Investigación de mercado</h1>
      <p style={{ ...apagado, marginBottom: 24 }}>
        SOEC revisa tu sitio, mide la demanda real de búsqueda y comprueba qué territorio puede alcanzar. Sólo
        consulta y observa: no crea campañas, no publica anuncios y no gasta tu presupuesto.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}

      <section style={seccion}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button type="button" onClick={() => void lanzar(false)} disabled={ocupado || vista?.puedeInvestigar.puede === false}>
            {ocupado ? 'Investigando…' : corrida === null ? 'Investigar mi mercado' : 'Actualizar investigación'}
          </button>
          {corrida !== null && (
            <button type="button" onClick={() => void lanzar(true)} disabled={ocupado}>
              Repetir desde cero
            </button>
          )}
        </div>
        {vista?.puedeInvestigar.puede === false && (
          <p style={{ color: '#b58900', marginBottom: 12 }}>{vista.puedeInvestigar.motivo}</p>
        )}
        {corrida === null && <p style={apagado}>Todavía no se ha investigado este negocio.</p>}
        {corrida !== null && (
          <>
            <p style={{ marginBottom: 8 }}>
              Estado: <strong>{ESTADO_CORRIDA[corrida.estado] ?? corrida.estado}</strong>
              {' · '}iniciada el {fecha(corrida.iniciadoEn)}
              {corrida.completadoEn !== null ? ` · terminada el ${fecha(corrida.completadoEn)}` : ''}
            </p>
            {corrida.motivoStale !== null && (
              <p style={{ color: '#b58900', marginBottom: 8 }}>
                Esta investigación quedó vieja: {corrida.motivoStale}. Conviene repetirla antes de decidir.
              </p>
            )}
            {vista !== null && vista.frescura.vencida && corrida.motivoStale === null && (
              <p style={{ color: '#b58900', marginBottom: 8 }}>
                Los datos tienen más de {Math.round(vista.frescura.horas / 24)} días. Puedes actualizarlos cuando quieras.
              </p>
            )}
            {corrida.fallos.length > 0 && (
              <p style={{ marginBottom: 8 }}>
                No todo se pudo consultar: {corrida.fallos.join(' · ')}. Lo que sí se obtuvo se conserva.
              </p>
            )}
            <h2 style={titulo}>De dónde salieron los datos</h2>
            <ul style={{ paddingLeft: 18, marginBottom: 8 }}>
              {corrida.fuentes.map((f) => (
                <li key={f.fuente}>
                  {NOMBRE_FUENTE[f.fuente] ?? f.fuente}:{' '}
                  <strong>{ETIQUETA_DISPONIBILIDAD[f.disponibilidad] ?? f.disponibilidad}</strong>
                  {f.motivo !== null ? ` — ${f.motivo}` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {vista !== null && vista.hallazgos.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Qué encontramos</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.hallazgos.map((h) => (
              <li key={h.id} style={{ marginBottom: 6 }}>
                {h.statement}
                <span style={{ ...apagado, fontSize: 13 }}>
                  {' '}(confianza {CONFIANZA[h.confianza] ?? h.confianza}
                  {h.evidenciaIds.length > 0
                    ? `, apoyado en ${h.evidenciaIds.length} dato${h.evidenciaIds.length === 1 ? '' : 's'} observado${h.evidenciaIds.length === 1 ? '' : 's'}`
                    : ''}
                  )
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {vista !== null && vista.canales.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Dónde tiene sentido invertir</h2>
          <p style={{ ...apagado, marginBottom: 8 }}>
            No hay un ranking ni una puntuación: cada canal se juzga con lo que hoy se sabe, y «faltan datos» es
            una respuesta legítima.
          </p>
          {vista.canales.map((c) => (
            <div key={c.canal} style={{ marginBottom: 12 }}>
              <strong>{NOMBRE_CANAL[c.canal] ?? c.canal}</strong>:{' '}
              <span style={{ color: COLOR_VEREDICTO[c.veredicto] ?? '#666' }}>{ETIQUETA_VEREDICTO[c.veredicto]}</span>
              <ul style={{ paddingLeft: 18, margin: '4px 0 0' }}>
                {c.motivos.map((m) => <li key={m} style={apagado}>{m}</li>)}
              </ul>
            </div>
          ))}
        </section>
      )}

      {terminos.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Qué busca la gente</h2>
          <p style={{ ...apagado, marginBottom: 8 }}>
            Que exista demanda no significa que convenga comprarla: esto es lo observado, la decisión va en el plan.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>Búsqueda</th>
                  <th style={{ padding: '4px 8px' }}>Veces por mes</th>
                  <th style={{ padding: '4px 8px' }}>Qué quiere quien busca</th>
                </tr>
              </thead>
              <tbody>
                {candidatas.slice(0, 40).map((t) => (
                  <tr key={t.id}>
                    <td style={{ padding: '4px 8px 4px 0' }}>{t.termino}</td>
                    <td style={{ padding: '4px 8px' }}>
                      {typeof t.metricas.avgMonthlySearches === 'number'
                        ? t.metricas.avgMonthlySearches.toLocaleString()
                        : 'sin dato'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>{ETIQUETA_INTENCION[t.intencion] ?? t.intencion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {candidatas.length > 40 && <p style={apagado}>y {candidatas.length - 40} búsquedas más.</p>}
          {revisar.length > 0 && (
            <p style={{ marginTop: 12 }}>
              {revisar.length} búsqueda{revisar.length === 1 ? '' : 's'} quedaron para revisar: no está claro si
              corresponden a tu negocio.
            </p>
          )}
        </section>
      )}

      {vista !== null && (excluidas.length > 0 || vista.candidatosNegativos.length > 0) && (
        <section style={seccion}>
          <h2 style={titulo}>Búsquedas que conviene dejar fuera</h2>
          <p style={{ ...apagado, marginBottom: 8 }}>
            Son <strong>propuestas</strong>: todavía no están aplicadas a ninguna campaña. Cada una dice por qué.
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {vista.candidatosNegativos.length > 0
              ? vista.candidatosNegativos.slice(0, 30).map((n) => (
                <li key={n.termino}>{n.termino} — {n.motivo}</li>
              ))
              : excluidas.slice(0, 30).map((t) => (
                <li key={t.id}>{t.termino} — {t.motivoExclusion ?? 'no corresponde a tu negocio'}</li>
              ))}
          </ul>
        </section>
      )}

      {vista !== null && vista.geos.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Hasta dónde se puede llegar</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.geos.map((g) => (
              <li key={g.solicitado} style={{ marginBottom: 4 }}>
                {g.solicitado}:{' '}
                {g.disponible ? (
                  <>
                    se puede segmentar {g.aproximacion ? 'de forma aproximada' : 'con exactitud'}
                    {g.aproximacion ? ` (riesgo de mostrarse fuera: ${DERRAME[g.riesgoDerrame] ?? g.riesgoDerrame})` : ''}
                  </>
                ) : (
                  <span style={{ color: '#b58900' }}>
                    no se puede segmentar tal cual: hay que acordar cómo representarlo antes de invertir ahí
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vista !== null && vista.landings.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Tus páginas de destino</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.landings.map((l) => (
              <li key={l.ofertaSlug} style={{ marginBottom: 6 }}>
                <strong>{l.ofertaSlug}</strong>: {ETIQUETA_LANDING[l.estado]}
                {l.url !== null ? ` · ${l.url}` : ''}
                {l.motivos.length > 0 && (
                  <ul style={{ paddingLeft: 18, margin: '2px 0 0' }}>
                    {l.motivos.map((m) => <li key={m} style={apagado}>{m}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vista !== null && vista.competidores.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Quién más compite por lo mismo</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.competidores.map((c) => <li key={c.dominio}>{c.nombre} ({c.dominio})</li>)}
          </ul>
        </section>
      )}

      {vista !== null && vista.evidencias.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Datos observados, uno por uno</h2>
          <p style={{ ...apagado, marginBottom: 8 }}>Cada línea dice de dónde salió y cuándo se observó.</p>
          <ul style={{ paddingLeft: 18, fontSize: 14 }}>
            {vista.evidencias.slice(0, 60).map((e) => (
              <li key={e.id} style={{ marginBottom: 4 }}>
                {e.statement}
                <span style={apagado}>
                  {' — '}{NOMBRE_FUENTE[e.fuente] ?? e.fuente}
                  {e.periodo !== null ? `, ${e.periodo}` : ''}, {fecha(e.observadoEn)}
                </span>
              </li>
            ))}
          </ul>
          {vista.evidencias.length > 60 && <p style={apagado}>y {vista.evidencias.length - 60} datos más.</p>}
        </section>
      )}

      {corrida !== null && (
        <p style={{ ...apagado, fontSize: 13 }}>
          Investigar no autoriza nada: ni crea campañas, ni cambia presupuestos, ni gasta. Lo que SOEC propone
          hacer con esto está en <Link href="/negocios/plan">tu plan de marketing</Link>.
        </p>
      )}
    </main>
  );
}
