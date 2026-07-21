'use client';

import { useCallback, useEffect, useState } from 'react';
import { ejecutarSiguiente, estadoMarketing, pausarPlan, prepararMarketing, reanudarPlan, replanificar } from '../../lib/marketing-client';
import type { Actividad, EstadoMarketing, ResultadoEjecucion } from '../../lib/marketing-types';

const TONO: Record<string, string> = {
  autorizable: 'warn',
  verificada: 'ok',
  bloqueada: 'danger',
  omitida: 'danger',
};

function fecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CL');
  } catch {
    return iso;
  }
}

function ActividadFila({ a }: { a: Actividad }) {
  const tono = TONO[a.estado] ?? 'reserved';
  return (
    <li>
      <span className={`badge badge--${tono}`}>{a.estado}</span> <strong>{a.canal}</strong> · {fecha(a.fechaProgramada)}
      {a.costo > 0 && <span className="chip">costo {a.costo}</span>}
      <div className="small muted">{a.explicacion}</div>
      {a.resultado && <div className="small">→ {a.resultado}</div>}
    </li>
  );
}

export default function MarketingPage() {
  const [estado, setEstado] = useState<EstadoMarketing | null>(null);
  const [ultimo, setUltimo] = useState<ResultadoEjecucion | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const refrescar = useCallback(async () => {
    setEstado(await estadoMarketing());
  }, []);

  useEffect(() => {
    (async () => {
      await prepararMarketing();
      await refrescar();
    })();
  }, [refrescar]);

  const accion = useCallback(
    async (fn: () => Promise<unknown>) => {
      setOcupado(true);
      try {
        const r = await fn();
        if (r && typeof r === 'object' && 'permitida' in r) setUltimo(r as ResultadoEjecucion);
        await refrescar();
      } finally {
        setOcupado(false);
      }
    },
    [refrescar],
  );

  if (!estado?.plan) {
    return (
      <div>
        <h1>Centro de control de marketing</h1>
        <section className="card"><span className="spinner" /> Preparando el plan de la empresa…</section>
      </div>
    );
  }
  const p = estado.plan;
  const pausado = p.estado === 'pausado';

  return (
    <div>
      <h1>Centro de control de marketing</h1>
      <p className="muted">Esto es el trabajo que SOEC realiza por la empresa dentro de las políticas autorizadas. No son consejos: son acciones planificadas, autorizadas y verificadas.</p>

      <section className="card">
        <div className="kv">
          <dt>Empresa</dt><dd>{estado.empresa}</dd>
          <dt>Objetivo</dt><dd>{estado.objetivo?.objetivoComercial} — de {estado.objetivo?.lineaBase} a {estado.objetivo?.valorEsperado} {estado.objetivo?.indicador} en {estado.objetivo?.horizonteDias} días</dd>
          <dt>Plan</dt><dd>versión {p.planVersion} · <span className={`badge badge--${pausado ? 'warn' : 'ok'}`}>{p.estado}</span></dd>
          <dt>Presupuesto</dt><dd>{p.presupuesto?.total} {p.presupuesto?.moneda}</dd>
        </div>
      </section>

      <div style={{ margin: '10px 0' }}>
        <button className="btn" disabled={ocupado || pausado || !estado.siguiente} onClick={() => accion(ejecutarSiguiente)}>
          Ejecutar la próxima acción
        </button>{' '}
        <button className="btn btn--sec" disabled={ocupado} onClick={() => accion(replanificar)}>Replanificar</button>{' '}
        {pausado
          ? <button className="btn btn--sec" disabled={ocupado} onClick={() => accion(reanudarPlan)}>Reanudar</button>
          : <button className="btn btn--sec" disabled={ocupado} onClick={() => accion(pausarPlan)}>Pausar todo</button>}
      </div>

      {ultimo && (
        <section className="card">
          <strong>{ultimo.permitida ? 'Acción ejecutada' : 'Acción denegada por la política'}</strong>
          <p className="small">Actividad <code>{ultimo.actividad}</code>: {ultimo.resultado}{ultimo.motivo && !ultimo.permitida ? ` (${ultimo.motivo})` : ''}. {ultimo.permitida ? 'Efecto simulado; ningún efecto externo real.' : ''}</p>
        </section>
      )}

      <h2>Próxima acción</h2>
      <section className="card">
        {estado.siguiente
          ? <p>La actividad <strong>{estado.siguiente.canal}</strong> del {fecha(estado.siguiente.fechaProgramada)} está autorizada para ejecutarse.</p>
          : <p className="muted">No hay acciones ejecutables pendientes.</p>}
      </section>

      <h2>Campañas</h2>
      <section className="card">
        <ul className="limpia">
          {p.campanias.map((c) => (
            <li key={c.id}><strong>{c.nombre}</strong> <span className="chip">{c.canal}</span>{c.presupuesto > 0 && <span className="chip">{c.presupuesto} {p.presupuesto?.moneda}</span>}<div className="small muted">{c.porque}</div></li>
          ))}
        </ul>
      </section>

      <h2>Calendario y actividades</h2>
      <section className="card">
        <ul className="limpia">
          {p.actividades.map((a) => <ActividadFila key={a.id} a={a} />)}
        </ul>
      </section>

      {p.historial.length > 1 && (
        <details>
          <summary>Historial de versiones del plan</summary>
          <ul className="limpia small traza">
            {p.historial.map((h, i) => <li key={i}>v{h.planVersion}: {h.motivo}</li>)}
          </ul>
        </details>
      )}

      <p className="small muted" style={{ marginTop: 14 }}>Ningún efecto externo real ocurre aquí: las publicaciones y anuncios son simulados. La estrategia, el presupuesto y los límites los define la persona.</p>
    </div>
  );
}
