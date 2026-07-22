'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ejecutarSiguienteContenido,
  estadoContenido,
  prepararActividad,
  prepararContenido,
  prepararTodo,
} from '../../lib/contenido-client';
import type { ActividadContenido, EstadoContenido, PaqueteResumen } from '../../lib/contenido-types';

const TONO: Record<string, string> = {
  autorizable: 'warn',
  autorizado: 'ok',
  listo: 'ok',
  verificado: 'ok',
  verificada: 'ok',
  bloqueada: 'danger',
  denegado: 'danger',
  incompleto: 'danger',
};

function badge(estado: string) {
  return `badge badge--${TONO[estado] ?? 'reserved'}`;
}

function Paquete({ p }: { p: PaqueteResumen }) {
  return (
    <div className="small" style={{ marginTop: 6 }}>
      <div>
        <span className={badge(p.estado)}>{p.estado}</span> paquete · resultado <strong>{p.resultado}</strong>
        {p.ejecucion && <span className="chip">→ {p.ejecucion}</span>}
      </div>
      {p.revisiones.length > 0 && (
        <div className="muted">Revisiones automáticas: {p.revisiones.map((r) => `#${r.ronda} ${r.accion}`).join(' · ')}</div>
      )}
      {p.hallazgos.length > 0 && (
        <details>
          <summary>{p.hallazgos.length} hallazgo(s) editoriales</summary>
          <ul className="limpia">
            {p.hallazgos.map((h, i) => (
              <li key={i}>
                <span className={`badge badge--${h.bloqueante ? 'danger' : 'reserved'}`}>{h.severidad}</span> <code>{h.codigo}</code>: {h.descripcion}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>{p.adaptaciones.length} adaptación(es) por canal</summary>
        <ul className="limpia">
          {p.adaptaciones.map((a, i) => (
            <li key={i}>
              <span className={badge(a.estado)}>{a.estado}</span> <strong>{a.canal}</strong> <span className="chip">{a.formato}</span>
              {a.titulo && <div><em>{a.titulo}</em></div>}
              <div className="muted">{a.cuerpo}</div>
              {a.hashtags.length > 0 && <div className="muted">{a.hashtags.map((h) => `#${h}`).join(' ')}</div>}
              <div className="muted">CTA: {a.llamadaAccion}</div>
            </li>
          ))}
        </ul>
      </details>
      {p.activos.length > 0 && (
        <details>
          <summary>{p.activos.length} activo(s)</summary>
          <ul className="limpia">
            {p.activos.map((a, i) => <li key={i}><span className="chip">{a.tipo}</span> {a.descripcion}</li>)}
          </ul>
        </details>
      )}
      {p.afirmaciones.length > 0 && (
        <details>
          <summary>Procedencia de las afirmaciones</summary>
          <ul className="limpia">
            {p.afirmaciones.map((af, i) => <li key={i}><span className="chip">{af.tipo}</span> {af.texto} <span className="muted">({af.fuente})</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Actividad({ a, onPreparar, ocupado }: { a: ActividadContenido; onPreparar: (id: string) => void; ocupado: boolean }) {
  const necesita = a.estado === 'bloqueada' && a.motivoBloqueo === 'contenido_faltante';
  return (
    <li>
      <span className={badge(a.estado)}>{a.estado}</span> <strong>{a.canal}</strong>
      {a.motivoBloqueo && <span className="chip">{a.motivoBloqueo}</span>}
      {necesita && (
        <button className="btn btn--sec" style={{ marginLeft: 8 }} disabled={ocupado} onClick={() => onPreparar(a.id)}>
          Preparar contenido
        </button>
      )}
      {a.paquete && <Paquete p={a.paquete} />}
    </li>
  );
}

export default function ContenidoPage() {
  const [estado, setEstado] = useState<EstadoContenido | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    setEstado(await estadoContenido());
  }, []);

  useEffect(() => {
    (async () => {
      await prepararContenido();
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

  if (!estado?.plan) {
    return (
      <div>
        <h1>Fábrica de contenido</h1>
        <section className="card"><span className="spinner" /> Preparando la estrategia y las plantillas…</section>
      </div>
    );
  }

  const pendientes = estado.actividades.filter((a) => a.estado === 'bloqueada' && a.motivoBloqueo === 'contenido_faltante').length;

  return (
    <div>
      <h1>Fábrica de contenido</h1>
      <p className="muted">
        SOEC produce el material de marketing por la empresa: redacta la pieza, la adapta a cada canal, valida contra la marca y la política, corrige lo corregible y deja el paquete listo para una publicación controlada. No son sugerencias: es trabajo realizado.
      </p>

      <section className="card">
        <div className="kv">
          <dt>Empresa</dt><dd>{estado.empresa}</dd>
          <dt>Marca</dt><dd>{estado.marca}</dd>
          <dt>Plan</dt><dd>versión {estado.plan.planVersion} · <span className={badge(estado.plan.estado)}>{estado.plan.estado}</span></dd>
          <dt>Pendientes de contenido</dt><dd>{pendientes}</dd>
        </div>
      </section>

      <div style={{ margin: '10px 0' }}>
        <button
          className="btn"
          disabled={ocupado || pendientes === 0}
          onClick={() => correr(prepararTodo, (r) => {
            const x = r as { preparadas: number; desbloqueadas: number };
            return `SOEC preparó contenido para ${x.preparadas} actividad(es) y dejó ${x.desbloqueadas} lista(s) para ejecución.`;
          })}
        >
          Preparar todo el contenido
        </button>{' '}
        <button
          className="btn btn--sec"
          disabled={ocupado}
          onClick={() => correr(ejecutarSiguienteContenido, (r) => {
            const x = r as { actividad: string | null; permitida: boolean; resultado: string };
            return x.actividad ? `SOEC ejecutó ${x.actividad}: ${x.resultado} (efecto simulado).` : 'No hay acciones autorizables por ahora.';
          })}
        >
          Ejecutar la próxima acción
        </button>
      </div>

      {mensaje && <section className="card"><strong>{mensaje}</strong></section>}

      <h2>Trabajo por actividad</h2>
      <section className="card">
        <ul className="limpia">
          {estado.actividades.map((a) => (
            <Actividad
              key={a.id}
              a={a}
              ocupado={ocupado}
              onPreparar={(id) => correr(
                () => prepararActividad(id),
                (r) => {
                  const x = r as { actividadDesbloqueada: boolean; motivo: string; paquete: { adaptaciones: unknown[]; revisiones: unknown[] } };
                  return x.actividadDesbloqueada
                    ? `SOEC preparó el contenido, creó ${x.paquete.adaptaciones.length} adaptación(es)${x.paquete.revisiones.length ? ` y corrigió ${x.paquete.revisiones.length} hallazgo(s)` : ''}, y dejó el paquete listo para ejecución.`
                    : `SOEC produjo un borrador pero no lo entregó: ${x.motivo}.`;
                },
              )}
            />
          ))}
        </ul>
      </section>

      <p className="small muted" style={{ marginTop: 14 }}>
        Ningún efecto externo real ocurre aquí: la generación usa un proveedor determinista (no IA real) y la publicación es simulada. La estrategia, el presupuesto y los límites los define la persona; la ejecución pasa por la autorización de la política.
      </p>
    </div>
  );
}
