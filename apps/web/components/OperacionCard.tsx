import type { ProductoOperacion } from '../lib/types';
import { operacionHumana, queEncontro } from '../lib/estado';

function Lista({ titulo, items }: { titulo: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small muted">{titulo}</div>
      <ul className="limpia small">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export function OperacionCard({ o }: { o: ProductoOperacion }) {
  const d = o.detalle;
  return (
    <section className={`card op op--${o.operacion}`}>
      <h3>{operacionHumana(o.operacion)}</h3>
      <p className="small">{queEncontro(o)}</p>

      {d.deteccion && d.deteccion.senales.length > 0 && (
        <ul className="limpia small">
          {d.deteccion.senales.map((s, i) => (
            <li key={i}>
              <strong>{s.objeto}</strong>
              {s.noEvaluable && <span className="chip">no evaluable</span>}
              {s.posibleFalsoPositivo && <span className="chip">posible falso positivo</span>}
              <span className="chip">incertidumbre: {s.incertidumbre}</span>
            </li>
          ))}
        </ul>
      )}
      {d.esclarecimiento && d.esclarecimiento.lados.length > 0 && (
        <ul className="limpia small">
          {d.esclarecimiento.lados.map((l, i) => (
            <li key={i}>
              <span className="chip">{l.tipo}</span> {l.referencia}
            </li>
          ))}
        </ul>
      )}

      <Lista titulo="Razones" items={o.razones} />
      <Lista titulo="Información faltante" items={o.faltante} />
      <Lista titulo="Limitaciones" items={o.limitaciones} />

      <details>
        <summary>Ver en qué se basa (evidencia y procedencia)</summary>
        <div className="traza">
          <div>
            <span className="muted">Procedencia:</span> {o.procedencia}
          </div>
          <div>
            <span className="muted">Incertidumbre:</span> {o.incertidumbre}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="muted">Evidencia:</span>{' '}
            {o.evidencia.length === 0 ? <em>sin evidencia registrada</em> : o.evidencia.map((e, i) => <span key={i} className="chip">{e}</span>)}
          </div>
          <dl className="kv" style={{ marginTop: 8 }}>
            {d.mecanismo && (
              <>
                <dt>Mecanismo</dt>
                <dd>
                  {d.mecanismo} {d.mecanismoVersion && <span className="muted">v{d.mecanismoVersion}</span>}
                </dd>
              </>
            )}
            {d.eceCorte && (
              <>
                <dt>Corte del estado</dt>
                <dd>versión {d.eceCorte.version}</dd>
              </>
            )}
          </dl>
        </div>
      </details>
    </section>
  );
}
