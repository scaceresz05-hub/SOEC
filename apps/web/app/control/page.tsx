'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { actividadControl, decisionesControl, pausarControl, prepararControl, resolverDecision, resumenControl, simularControl } from '../../lib/control-client';
import type { DecisionPendiente, ResumenControl } from '../../lib/control-types';

const SALUD: Record<string, { tono: string; texto: string }> = {
  saludable: { tono: 'ok', texto: 'Saludable' },
  operando_con_advertencias: { tono: 'warn', texto: 'Operando con advertencias' },
  degradado: { tono: 'warn', texto: 'Degradado' },
  parcialmente_bloqueado: { tono: 'danger', texto: 'Parcialmente bloqueado' },
  intervencion_requerida: { tono: 'danger', texto: 'Intervención requerida' },
  pausado: { tono: 'reserved', texto: 'Pausado' },
  sin_informacion: { tono: 'reserved', texto: 'Sin información suficiente' },
};

export default function ControlPage() {
  const [resumen, setResumen] = useState<ResumenControl | null>(null);
  const [decisiones, setDecisiones] = useState<DecisionPendiente[]>([]);
  const [actividad, setActividad] = useState<{ texto: string }[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [escenario, setEscenario] = useState('bajo');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refrescar = useCallback(async () => {
    const [r, d, a] = await Promise.all([resumenControl(), decisionesControl(), actividadControl()]);
    setResumen(r);
    setDecisiones(d.decisiones.filter((x) => x.estado === 'pendiente'));
    setActividad(a.entradas);
  }, []);

  useEffect(() => {
    (async () => {
      await prepararControl();
      await refrescar();
    })();
    timer.current = setInterval(() => void refrescar(), 6000); // actualización controlada (polling)
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refrescar]);

  const correr = useCallback(
    async (fn: () => Promise<unknown>, describir?: (r: unknown) => string) => {
      setOcupado(true);
      try {
        const r = await fn();
        if (describir) setMensaje(describir(r));
        await refrescar();
      } finally {
        setOcupado(false);
      }
    },
    [refrescar],
  );

  if (!resumen) {
    return (
      <div>
        <h1>Centro de control</h1>
        <section className="card"><span className="spinner" /> Preparando el departamento…</section>
      </div>
    );
  }
  const salud = SALUD[resumen.salud] ?? { tono: 'reserved', texto: resumen.salud };
  const p = resumen.presupuesto;

  return (
    <div>
      <h1>Centro de control del departamento</h1>
      <p className="muted">Usted dirige el departamento; SOEC realiza el trabajo. Supervise resultados, riesgos y decisiones; intervenga solo cuando la estrategia o una excepción lo requieran.</p>

      <section className="card">
        <div className="kv">
          <dt>Empresa</dt><dd>{resumen.empresa} · {resumen.periodo}</dd>
          <dt>Estado</dt><dd><span className={`badge badge--${salud.tono}`}>{salud.texto}</span></dd>
          <dt>Modo</dt><dd><span className="badge badge--warn">{resumen.modo}</span> <span className="muted">(real desactivado · sin gasto real)</span></dd>
          <dt>Autonomía</dt><dd>nivel {resumen.nivelAutonomia}</dd>
        </div>
        <div style={{ marginTop: 8 }}>
          {resumen.pausaTotal
            ? <button className="btn" disabled={ocupado} onClick={() => correr(() => pausarControl(false), () => 'SOEC reanudó el departamento.')}>Reanudar departamento</button>
            : <button className="btn btn--sec" disabled={ocupado} onClick={() => correr(() => pausarControl(true), () => 'SOEC pausó el departamento: no se producirán nuevos efectos.')}>Pausar todo</button>}{' '}
          <label className="small muted">Escenario:{' '}
            <select value={escenario} onChange={(e) => setEscenario(e.target.value)} disabled={ocupado}>
              <option value="bajo">bajo desempeño</option>
              <option value="alto">alto desempeño</option>
              <option value="insuficiente">evidencia insuficiente</option>
              <option value="gasto_excedido">gasto excedido</option>
            </select>
          </label>{' '}
          <button className="btn btn--sec" disabled={ocupado} onClick={() => correr(() => simularControl(escenario), (r) => {
            const x = r as { medidas: number; aplicadas: number; decisiones: number; alertas: number; pausado: boolean };
            return x.pausado ? 'El departamento está pausado: no se ejecutó ningún efecto.' : `SOEC midió ${x.medidas}, aplicó ${x.aplicadas} optimización(es), abrió ${x.decisiones} decisión(es) y ${x.alertas} alerta(s).`;
          })}>Ejecutar un ciclo</button>
        </div>
      </section>
      {mensaje && <section className="card"><strong>{mensaje}</strong></section>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <section className="card">
          <h2>Trabajo realizado</h2>
          <ul className="limpia small">
            <li>Piezas creadas: <strong>{resumen.trabajo.piezasCreadas}</strong></li>
            <li>Publicaciones verificadas: <strong>{resumen.trabajo.publicacionesVerificadas}</strong> / {resumen.trabajo.publicacionesPreparadas}</li>
            <li>Campañas activas: <strong>{resumen.trabajo.campaniasActivas}</strong></li>
            <li>Optimizaciones aplicadas: <strong>{resumen.trabajo.optimizacionesAplicadas}</strong></li>
            <li>Bloqueos: <strong>{resumen.trabajo.bloqueos}</strong></li>
          </ul>
        </section>
        <section className="card">
          <h2>Presupuesto ({p.moneda})</h2>
          <ul className="limpia small">
            <li>Producción: {p.produccion} · Publicidad: {p.publicidad}</li>
            <li>Planificado: {p.planificado} · Ejecutado: {p.ejecutado}</li>
            <li>Disponible: <strong>{p.disponible}</strong></li>
            {p.discrepancia > 0 && <li className="badge badge--danger">Discrepancia: {p.discrepancia}</li>}
          </ul>
        </section>
      </div>

      <h2>Objetivos</h2>
      <section className="card">
        <ul className="limpia small">
          {resumen.objetivos.length === 0 && <li className="muted">Aún sin evaluación. Ejecute un ciclo.</li>}
          {resumen.objetivos.map((o, i) => (
            <li key={i}><strong>{o.indicador}</strong> <span className="chip">{o.clasificacion}</span> <span className="chip">evidencia {o.calidad}</span> resultado {o.resultado === null ? 's/d' : (o.resultado * 100).toFixed(1) + '%'} (meta {(o.meta * 100).toFixed(1)}%)</li>
          ))}
        </ul>
      </section>

      {decisiones.length > 0 && (
        <>
          <h2>Decisiones pendientes</h2>
          <section className="card">
            <ul className="limpia">
              {decisiones.map((d) => (
                <li key={d.decId}>
                  <span className={`badge badge--${d.riesgo === 'alto' ? 'danger' : 'warn'}`}>{d.tipo}</span> {d.razon}
                  <div className="small muted">Recomendación: {d.recomendacion}</div>
                  <button className="btn btn--sec" disabled={ocupado} onClick={() => correr(() => resolverDecision(d.decId, 'aprobada'), (r) => `SOEC aplicó la decisión (${(r as { efectoAplicado: boolean }).efectoAplicado ? 'efecto versionado en el plan' : 'sin efecto'}).`)}>Aprobar</button>{' '}
                  <button className="btn btn--sec" disabled={ocupado} onClick={() => correr(() => resolverDecision(d.decId, 'denegada'), () => 'SOEC registró la denegación.')}>Denegar</button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {resumen.excepciones.length > 0 && (
        <>
          <h2>Excepciones</h2>
          <section className="card">
            <ul className="limpia small">
              {resumen.excepciones.map((e, i) => (
                <li key={i}><span className={`badge badge--${e.severidad === 'critico' ? 'danger' : 'warn'}`}>{e.tipo}</span> {e.descripcion} <div className="muted">Automático: {e.accionAutomatica} · Requiere: {e.accionHumana}</div></li>
              ))}
            </ul>
          </section>
        </>
      )}

      <h2>Actividad reciente</h2>
      <section className="card">
        <ul className="limpia small">
          {actividad.length === 0 && <li className="muted">Sin actividad todavía.</li>}
          {actividad.slice(0, 8).map((a, i) => <li key={i}>{a.texto}</li>)}
        </ul>
      </section>

      <p className="small muted" style={{ marginTop: 14 }}>Entorno sintético/emulado. No se realizó ninguna acción pública ni gasto real. El modo real permanece desactivado; el escalamiento requiere aprobación; la pausa detiene los efectos pero no las lecturas.</p>
    </div>
  );
}
