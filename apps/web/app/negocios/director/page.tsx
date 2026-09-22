'use client';

/**
 * TU DIRECTOR — qué está observando SOEC, qué decidió y qué necesita de ti.
 *
 * Es la pantalla del ciclo: observar → evaluar → decidir → (pedir permiso) → aplicar → verificar → aprender.
 * Tres reglas de esta interfaz:
 *  · lo que espera tu permiso va PRIMERO, con su porqué, su riesgo y su impacto máximo;
 *  · «todavía no hay datos suficientes» se dice tal cual, sin disfrazarlo de actividad;
 *  · el modo automático enseña sus consecuencias antes de encenderse, no después.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ETIQUETA_ACCION,
  ETIQUETA_APRENDIZAJE,
  ETIQUETA_ESTADO_CICLO,
  ETIQUETA_MEDICION,
  ETIQUETA_MODO_CICLO,
  ETIQUETA_RIESGO,
  cambiarModoOperativo,
  correrCiclo,
  encenderCampana,
  guardarLimites,
  leerOptimizacion,
  resolverPendiente,
  type VistaOptimizacion,
} from '../../../lib/optimizacion-client';

const seccion = { marginBottom: 32 } as const;
const titulo = { fontSize: 18, marginBottom: 8 } as const;
const apagado = { color: 'var(--muted, #666)' } as const;
const campo = { width: 90, padding: 6, marginLeft: 8 } as const;

const ACCIONES_CONFIGURABLES: { id: string; etiqueta: string; nota: string }[] = [
  { id: 'PAUSE_CAMPAIGN', etiqueta: 'Pausar la campaña si gasta sin resultados', nota: 'reduce el gasto; siempre reversible' },
  { id: 'ADD_NEGATIVE_KEYWORD', etiqueta: 'Excluir búsquedas que no corresponden', nota: 'por ejemplo, gente buscando empleo' },
  { id: 'PAUSE_KEYWORD', etiqueta: 'Dejar de pujar por búsquedas improductivas', nota: 'sólo con gasto y clics suficientes' },
  { id: 'ADJUST_DAILY_BUDGET', etiqueta: 'Ajustar el presupuesto diario', nota: 'nunca por encima de lo que autorizaste' },
  { id: 'ADJUST_MAX_CPC', etiqueta: 'Ajustar el precio máximo por visita', nota: 'sólo en campañas que lo usan' },
];

/**
 * Importe en unidades MENORES → texto con SU moneda. El servidor dice cuál es: escribir «$» sin preguntarla
 * convertiría cualquier importe en pesos a los ojos de quien lo lee.
 */
const dinero = (v: number | null | undefined, moneda: string): string => {
  if (v === null || v === undefined) return 'sin dato';
  const decimales = moneda === 'CLP' || moneda === 'JPY' ? 0 : 2;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: decimales })
    .format(v / 10 ** decimales);
};
const num = (v: number | null | undefined): string => (v === null || v === undefined ? 'sin dato' : Math.round(v).toLocaleString('es-CL'));

export default function DirectorPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaOptimizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      setVista(await leerOptimizacion(o));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo leer el estado del director');
    }
  }, []);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  async function accion(fn: () => Promise<VistaOptimizacion | void>, mensaje?: string): Promise<void> {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fn();
      if (r) setVista(r);
      else if (org !== null) await cargar(org);
      if (mensaje) setAviso(mensaje);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'la operación no se completó');
    } finally {
      setOcupado(false);
    }
  }

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Tu director</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const ciclo = vista?.ciclo ?? null;
  const politica = vista?.politica ?? null;
  const modo = vista?.modoOperativo ?? null;
  const automatico = modo === 'AUTONOMOUS_REAL';
  const moneda = vista?.moneda ?? 'CLP';

  return (
    <main className="wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/negocios">← Volver al panel</Link>
        <Link href="/negocios/campana">Preparar campaña</Link>
        <Link href="/negocios/plan">Plan de marketing</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Tu director</h1>
      <p style={{ ...apagado, marginBottom: 24 }}>
        SOEC observa tu campaña, decide qué conviene cambiar y —según lo que hayas autorizado— te lo propone o
        lo aplica. Todo cambio queda registrado con su porqué y se comprueba después en la plataforma.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}
      {aviso !== null && <p style={{ color: '#0a7', marginBottom: 16 }}>{aviso}</p>}

      {/* ── LO QUE ESPERA TU PERMISO ── */}
      {vista !== null && vista.pendientes.length > 0 && (
        <section style={{ ...seccion, border: '1px solid rgba(181,137,0,.4)', borderRadius: 6, padding: 12, background: 'rgba(181,137,0,.06)' }}>
          <h2 style={titulo}>SOEC necesita tu permiso</h2>
          {vista.pendientes.map((p) => (
            <div key={p.id} style={{ marginBottom: 16 }}>
              <p style={{ marginBottom: 4 }}>
                <strong>{ETIQUETA_ACCION[p.decision?.accion ?? ''] ?? p.decision?.accion}</strong>
                {p.decision !== null && <> · {p.decision.objetivo.nombre}</>}
              </p>
              {p.decision !== null && (
                <ul style={{ paddingLeft: 18, marginBottom: 8 }}>
                  <li>Por qué: {p.decision.motivo}</li>
                  <li>Qué se espera conseguir: {p.decision.efectoEsperado}</li>
                  <li>Cambio: {p.decision.estadoActual} → <strong>{p.decision.estadoPropuesto}</strong></li>
                  <li>Riesgo: {ETIQUETA_RIESGO[p.decision.riesgo] ?? p.decision.riesgo}
                    {p.decision.impactoMaximoClp !== null && <> · impacto máximo posible: {dinero(p.decision.impactoMaximoClp, moneda)}</>}
                    {p.decision.reversible && ' · se puede deshacer'}</li>
                </ul>
              )}
              <p style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={ocupado} onClick={() => void accion(() => resolverPendiente(org, p.id, 'APROBAR'), 'cambio aplicado')}>Aprobar</button>
                <button type="button" disabled={ocupado} onClick={() => void accion(() => resolverPendiente(org, p.id, 'RECHAZAR'), 'propuesta descartada')}>Rechazar</button>
              </p>
            </div>
          ))}
        </section>
      )}

      {/* ── ESTADO GENERAL ── */}
      <section style={seccion}>
        <h2 style={titulo}>Qué está pasando</h2>
        <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" disabled={ocupado} onClick={() => void accion(() => correrCiclo(org), 'revisión hecha')}>
            Revisar mi campaña ahora
          </button>
          <button type="button" disabled={ocupado} onClick={() => void accion(() => correrCiclo(org, 'SHADOW'), 'revisión en modo sombra: nada se cambió')}>
            Sólo dime qué harías
          </button>
        </p>
        {ciclo === null && <p style={apagado}>Todavía no se ha revisado esta campaña.</p>}
        {ciclo !== null && (
          <>
            <p style={{ marginBottom: 4 }}>
              Última revisión: <strong>{ETIQUETA_ESTADO_CICLO[ciclo.estado] ?? ciclo.estado}</strong> ·{' '}
              {ETIQUETA_MODO_CICLO[ciclo.modo] ?? ciclo.modo} · {new Date(ciclo.iniciadoEn).toLocaleString()}
            </p>
            {ciclo.motivo !== null && <p style={{ color: '#b58900', marginBottom: 8 }}>{ciclo.motivo}</p>}
            <p style={apagado}>Mirando lo ocurrido entre {ciclo.ventana.desde} y {ciclo.ventana.hasta}.</p>
          </>
        )}
        {vista?.snapshot != null && (
          <ul style={{ paddingLeft: 18, marginTop: 8 }}>
            <li>Gasto: {dinero(vista.snapshot.campania.spend, moneda)} · visitas: {num(vista.snapshot.campania.clicks)} · veces que apareció: {num(vista.snapshot.campania.impressions)}</li>
            <li>Clientes registrados: {num(vista.snapshot.campania.conversions)}{vista.snapshot.campania.cpa !== null && <> · costo por cliente: {dinero(vista.snapshot.campania.cpa, moneda)}</>}</li>
            <li>Medición: {ETIQUETA_MEDICION[vista.snapshot.saludMedicion] ?? vista.snapshot.saludMedicion}</li>
          </ul>
        )}
        {vista?.evidencia != null && vista.evidencia.veredicto !== 'SUFFICIENT' && (
          <p style={{ color: '#b58900', marginTop: 8 }}>{vista.evidencia.motivo}</p>
        )}
      </section>

      {/* ── CAMPAÑA: ENCENDER ── */}
      {vista?.campania != null && (
        <section style={seccion}>
          <h2 style={titulo}>Tu campaña</h2>
          <p style={{ marginBottom: 8 }}>
            Estado en Google: <strong>{vista.campania.estado === 'ENABLED' ? 'encendida' : vista.campania.estado === 'PAUSED' ? 'en pausa' : (vista.campania.estado ?? 'desconocido')}</strong>
          </p>
          {vista.campania.estado !== 'ENABLED' && (
            vista.campania.puedeActivarse
              ? (
                <>
                  <p style={{ marginBottom: 8 }}>Está todo listo para encenderla. A partir de ese momento empezará a gastar el presupuesto autorizado.</p>
                  <button type="button" disabled={ocupado} onClick={() => void accion(() => encenderCampana(org), 'campaña encendida')}>
                    Encender la campaña
                  </button>
                </>
              )
              : (
                <>
                  <p style={{ color: '#b58900' }}>Todavía no se puede encender:</p>
                  <ul style={{ paddingLeft: 18 }}>
                    {vista.campania.faltanParaActivar.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </>
              )
          )}
        </section>
      )}

      {/* ── QUÉ DECIDIÓ Y QUÉ CAMBIÓ ── */}
      {vista !== null && vista.decisiones.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Qué decidió en la última revisión</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.decisiones.map((d) => (
              <li key={d.id} style={{ marginBottom: 6 }}>
                <strong>{ETIQUETA_ACCION[d.accion] ?? d.accion}</strong> · {d.objetivo.nombre} — {d.motivo}
                <span style={{ ...apagado, fontSize: 13 }}> ({ETIQUETA_RIESGO[d.riesgo] ?? d.riesgo})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {vista !== null && vista.aplicadas.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Qué cambió</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.aplicadas.map((a, i) => (
              <li key={i}>
                {ETIQUETA_ACCION[a.accion] ?? a.accion} ·{' '}
                {a.resultado === 'APPLIED' ? 'aplicado' : a.resultado === 'NOOP_ALREADY_APPLIED' ? 'ya estaba aplicado' : a.resultado.toLowerCase()}
                {a.verificacion === 'VERIFIED' ? ' y comprobado en Google' : a.verificacion === 'DIVERGED' ? ' — pero Google muestra otra cosa' : ''}
                <span style={apagado}> · {new Date(a.aplicadoEn).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {vista !== null && vista.aprendizajes.length > 0 && (
        <section style={seccion}>
          <h2 style={titulo}>Cómo resultaron los cambios anteriores</h2>
          <ul style={{ paddingLeft: 18 }}>
            {vista.aprendizajes.map((l, i) => (
              <li key={i}>
                {ETIQUETA_ACCION[l.accion] ?? l.accion}: {ETIQUETA_APRENDIZAJE[l.resultado] ?? l.resultado}
                <span style={apagado}> · se buscaba {l.efectoEsperado}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── AUTONOMÍA ── */}
      <section style={seccion}>
        <h2 style={titulo}>Cuánto quieres que SOEC decida</h2>
        <p style={{ ...apagado, marginBottom: 12 }}>
          Cambiar esto es una decisión tuya y sólo tuya: no ocurre por completar el asistente, ni por conectar
          Google, ni por aprobar una campaña.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {([
            ['PILOT', 'Sólo observar', 'SOEC mira y te cuenta. No cambia nada.'],
            ['SUPERVISED_REAL', 'Pedirme permiso antes de cambiar', 'SOEC propone y tú apruebas cada cambio.'],
            ['AUTONOMOUS_REAL', 'Operar automáticamente dentro de mis límites', 'SOEC aplica sólo lo que autorices abajo, sin superar tu presupuesto.'],
          ] as const).map(([valor, etiqueta, nota]) => (
            <label key={valor} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                type="radio" name="modo" checked={modo === valor} disabled={ocupado}
                onChange={() => void accion(async () => { await cambiarModoOperativo(org, valor); }, `modo actualizado: ${etiqueta.toLowerCase()}`)}
              />
              <span><strong>{etiqueta}</strong><br /><span style={apagado}>{nota}</span></span>
            </label>
          ))}
        </div>

        {politica !== null && (
          <div className="card" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Tus límites para el modo automático</h3>
            {automatico && (
              <p style={{ color: '#b58900', marginBottom: 8 }}>
                Estás en modo automático: SOEC aplicará por su cuenta <strong>sólo</strong> lo marcado aquí, dentro de
                tu presupuesto autorizado, con un máximo de {politica.maxCambiosPorDia} cambios al día y
                esperando {politica.cooldownHoras} h entre cambios de lo mismo.
              </p>
            )}
            {ACCIONES_CONFIGURABLES.map((a) => (
              <label key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                <input
                  type="checkbox" disabled={ocupado} checked={politica.accionesPermitidas.includes(a.id)}
                  onChange={(e) => {
                    const acciones = e.target.checked
                      ? [...politica.accionesPermitidas, a.id]
                      : politica.accionesPermitidas.filter((x) => x !== a.id);
                    void accion(() => guardarLimites(org, { accionesPermitidas: acciones }), 'límites guardados');
                  }}
                />
                <span>{a.etiqueta}<br /><span style={{ ...apagado, fontSize: 13 }}>{a.nota}</span></span>
              </label>
            ))}
            <p style={{ marginTop: 12 }}>
              <label>
                Cambio máximo de presupuesto (%)
                <input
                  type="number" min={0} max={50} style={campo} defaultValue={politica.maxCambioPresupuestoPct}
                  onBlur={(e) => void accion(() => guardarLimites(org, { maxCambioPresupuestoPct: Number(e.target.value) }), 'límites guardados')}
                />
              </label>
            </p>
            <p>
              <label>
                Cambios automáticos por día
                <input
                  type="number" min={0} max={20} style={campo} defaultValue={politica.maxCambiosPorDia}
                  onBlur={(e) => void accion(() => guardarLimites(org, { maxCambiosPorDia: Number(e.target.value) }), 'límites guardados')}
                />
              </label>
            </p>
            <p>
              <label>
                Horas de espera entre cambios de lo mismo
                <input
                  type="number" min={1} max={168} style={campo} defaultValue={politica.cooldownHoras}
                  onBlur={(e) => void accion(() => guardarLimites(org, { cooldownHoras: Number(e.target.value) }), 'límites guardados')}
                />
              </label>
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
              <input
                type="checkbox" disabled={ocupado} checked={politica.activacionAutonomaPermitida}
                onChange={(e) => void accion(() => guardarLimites(org, { activacionAutonomaPermitida: e.target.checked }), 'límites guardados')}
              />
              <span>
                <strong>Dejar que SOEC encienda campañas por su cuenta</strong><br />
                <span style={{ ...apagado, fontSize: 13 }}>
                  Encender una campaña es empezar a gastar. Si esta casilla está apagada, SOEC nunca lo hará solo,
                  aunque estés en modo automático y tengas presupuesto autorizado.
                </span>
              </span>
            </label>
            <p style={{ ...apagado, fontSize: 13, marginTop: 12 }}>
              La <strong>pausa de seguridad</strong> funciona aparte y siempre: si tu campaña gasta sin resultados
              por encima de tu criterio, SOEC la detiene sin esperar a nadie.
            </p>
          </div>
        )}
      </section>

      {vista !== null && vista.historial.length > 1 && (
        <section style={seccion}>
          <h2 style={titulo}>Revisiones anteriores</h2>
          <ul style={{ paddingLeft: 18, fontSize: 14 }}>
            {vista.historial.map((x) => (
              <li key={x.id}>
                {new Date(x.iniciadoEn).toLocaleString()} · {ETIQUETA_ESTADO_CICLO[x.estado] ?? x.estado} ·{' '}
                {x.decisiones} decisión(es)
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
