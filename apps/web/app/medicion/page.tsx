'use client';

import { useCallback, useEffect, useState } from 'react';
import { estadoMedicion, optimizar, prepararMedicion, sincronizar } from '../../lib/medicion-client';
import type { ActividadMedicion, EstadoMedicion } from '../../lib/medicion-types';

const TONO: Record<string, string> = {
  sobre_objetivo: 'ok',
  dentro_de_rango: 'ok',
  bajo_umbral: 'danger',
  evidencia_insuficiente: 'warn',
  sin_datos: 'reserved',
  anomalia: 'danger',
};
const TONO_OPT: Record<string, string> = { aplicada: 'ok', autorizada: 'warn', denegada: 'danger', propuesta: 'reserved' };

function Fila({ a }: { a: ActividadMedicion }) {
  const tc = a.indicadores.find((i) => i.tipo === 'tasa_conversion');
  return (
    <li>
      <strong>{a.canal}</strong>
      {a.clasificacion && <span className={`badge badge--${TONO[a.clasificacion] ?? 'reserved'}`}>{a.clasificacion}</span>}
      {a.calidad && <span className="chip">evidencia {a.calidad}</span>}
      {tc && <span className="chip">conv {tc.valor === null ? 's/d' : `${(tc.valor * 100).toFixed(1)}%`}</span>}
      {a.atribucion && <span className="chip">atr {a.atribucion.clase}</span>}
      {a.anomalias.map((an, i) => <span key={i} className="badge badge--danger">{an.codigo}</span>)}
      {a.optimizacion && (
        <div className="small" style={{ marginTop: 4 }}>
          <span className={`badge badge--${TONO_OPT[a.optimizacion.estado] ?? 'reserved'}`}>{a.optimizacion.estado}</span> {a.optimizacion.tipo}
          {a.optimizacion.motivoDenegacion && <span className="muted"> · {a.optimizacion.motivoDenegacion}</span>}
        </div>
      )}
    </li>
  );
}

export default function MedicionPage() {
  const [estado, setEstado] = useState<EstadoMedicion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [escenario, setEscenario] = useState('bajo');

  const refrescar = useCallback(async () => setEstado(await estadoMedicion()), []);
  useEffect(() => {
    (async () => {
      await prepararMedicion();
      await refrescar();
    })();
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

  if (!estado?.existe) {
    return (
      <div>
        <h1>Medición y optimización</h1>
        <section className="card"><span className="spinner" /> Preparando y publicando el contenido…</section>
      </div>
    );
  }

  return (
    <div>
      <h1>Medición y optimización</h1>
      <p className="muted">
        SOEC observa el resultado de sus propias acciones, evalúa la calidad de la evidencia (la ausencia de datos no es fracaso), atribuye con cautela (sin confundir coincidencia con causa) y modifica su operación dentro de las políticas. No son recomendaciones: son decisiones evaluadas, autorizadas y versionadas.
      </p>
      <section className="card">
        <div className="kv">
          <dt>Empresa</dt><dd>{estado.empresa}</dd>
          <dt>Escenario de métricas</dt><dd><span className="chip">{estado.escenario}</span> <span className="muted">(datos sintéticos)</span></dd>
        </div>
      </section>

      <div style={{ margin: '10px 0' }}>
        <label className="small muted">Escenario:{' '}
          <select value={escenario} onChange={(e) => setEscenario(e.target.value)} disabled={ocupado}>
            <option value="bajo">bajo desempeño</option>
            <option value="alto">alto desempeño</option>
            <option value="insuficiente">evidencia insuficiente</option>
            <option value="gasto_excedido">gasto excedido</option>
          </select>
        </label>{' '}
        <button className="btn" disabled={ocupado} onClick={() => correr(() => sincronizar(escenario), (r) => `SOEC sincronizó y evaluó ${(r as { medidas: number }).medidas} publicación(es).`)}>Sincronizar y evaluar</button>{' '}
        <button className="btn btn--sec" disabled={ocupado} onClick={() => correr(optimizar, (r) => {
          const x = r as { propuestas: number; aplicadas: number; denegadas: number };
          return `SOEC evaluó ${x.propuestas} decisión(es): ${x.aplicadas} aplicada(s), ${x.denegadas} denegada(s) por política.`;
        })}>Optimizar (dentro de política)</button>
      </div>
      {mensaje && <section className="card"><strong>{mensaje}</strong></section>}

      <h2>Resultado por canal</h2>
      <section className="card">
        <ul className="limpia">{estado.actividades.map((a) => <Fila key={a.id} a={a} />)}</ul>
      </section>

      <p className="small muted" style={{ marginTop: 14 }}>
        Datos y proveedores sintéticos: ningún gasto real, ninguna publicación pública real. El escalamiento no es automático (requiere aprobación); una anomalía de gasto bloquea el escalamiento; los cambios se aplican por el motor de autorización y quedan versionados en el plan.
      </p>
    </div>
  );
}
