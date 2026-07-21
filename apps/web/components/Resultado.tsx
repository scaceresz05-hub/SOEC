import type { ResultadoExperiencia } from '../lib/types';
import { Encabezado } from './Encabezado';
import { Sintesis } from './Sintesis';
import { OperacionCard } from './OperacionCard';
import { AsuntosReservados } from './AsuntosReservados';

/** La vista se organiza por preguntas humanas, no por la arquitectura de SOEC. */
export function Resultado({ r }: { r: ResultadoExperiencia }) {
  const p = r.producto;
  const detectar = r.intermedios.find((i) => i.operacion === 'detectar');
  const senales = detectar?.detalle.deteccion?.senales ?? [];

  return (
    <div>
      <Encabezado r={r} />

      <p className="pregunta">1 · ¿Qué está ocurriendo en mi empresa?</p>
      <Sintesis r={r} />

      <p className="pregunta">2 · ¿Qué señales importantes detectó SOEC?</p>
      <section className="card">
        {senales.length === 0 ? (
          <p className="small muted">No se detectaron señales con sustento suficiente en este estado.</p>
        ) : (
          <ul className="limpia">
            {senales.map((s, i) => (
              <li key={i}>
                <strong>{s.objeto}</strong>
                {s.noEvaluable && <span className="chip">no evaluable</span>}
                {s.posibleFalsoPositivo && <span className="chip">posible falso positivo</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="pregunta">3 · ¿En qué información se basa?</p>
      <p className="small muted">Cada operación intelectual se muestra por separado, con su evidencia; no se fusionan en una conclusión imposible de auditar.</p>
      {r.intermedios.map((o, i) => (
        <OperacionCard key={i} o={o} />
      ))}

      <p className="pregunta">4 · ¿Qué no sabe todavía o qué resulta contradictorio?</p>
      <section className="card">
        {p && (p.contradiccionesAbiertas.length > 0 || p.faltante.length > 0) ? (
          <>
            {p.contradiccionesAbiertas.length > 0 && (
              <div>
                <h3>Contradicciones abiertas</h3>
                <ul className="limpia">
                  {p.contradiccionesAbiertas.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {p.faltante.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h3>Lo que aún no se sabe</h3>
                <ul className="limpia">
                  {p.faltante.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="small muted">No se registran contradicciones abiertas ni faltantes críticos en este estado.</p>
        )}
      </section>

      <p className="pregunta">5 · ¿Qué debo revisar o decidir personalmente?</p>
      <AsuntosReservados r={r} />

      {p && (
        <details>
          <summary>Trazabilidad técnica (para auditoría)</summary>
          <div className="traza">
            <dl className="kv">
              <dt>Capacidad</dt>
              <dd>
                {p.nombre} · v{p.version} · id <code>{r.capacidad.id}</code>
              </dd>
              <dt>Ejecución</dt>
              <dd>
                <code>{r.executionId}</code>
              </dd>
              <dt>Procedencia compuesta</dt>
              <dd>{p.procedencia}</dd>
              <dt>Operaciones</dt>
              <dd>
                {p.operacionesEjecutadas.map((o) => (
                  <div key={o.stepId}>
                    <code>{o.operacion}</code> [{o.stepId}] → <code>{o.operacionExecutionId}</code>
                  </div>
                ))}
              </dd>
              <dt>Decisión vinculante</dt>
              <dd>{String(p.bindingDecision)} (siempre falso: SOEC no decide)</dd>
            </dl>
          </div>
        </details>
      )}
    </div>
  );
}
