import type { ResultadoExperiencia } from '../lib/types';
import { estadoDe } from '../lib/estado';

function fecha(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CL');
  } catch {
    return iso;
  }
}

export function Encabezado({ r }: { r: ResultadoExperiencia }) {
  const e = estadoDe(r);
  return (
    <section className="card">
      <div className="kv">
        <dt>Empresa analizada</dt>
        <dd>{r.empresa}</dd>
        <dt>Estado del análisis</dt>
        <dd>
          <span className={`badge badge--${e.tono}`}>{e.etiqueta}</span>
        </dd>
        <dt>Capacidad</dt>
        <dd>
          {r.capacidad.nombre} <span className="muted small">v{r.capacidad.version}</span>
        </dd>
        <dt>Momento del estado</dt>
        <dd>{fecha(r.construidoEn)}</dd>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        SOEC informa y estructura; la decisión final corresponde a la persona.
      </p>
    </section>
  );
}
