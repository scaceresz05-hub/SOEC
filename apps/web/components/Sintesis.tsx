import type { ResultadoExperiencia } from '../lib/types';

/** Síntesis comprensible del estado — sin conclusión opaca ni calificación única. */
export function Sintesis({ r }: { r: ResultadoExperiencia }) {
  const p = r.producto;
  if (!p) return null;
  const detectar = r.intermedios.find((i) => i.operacion === 'detectar');
  const senales = detectar?.detalle.deteccion?.senales ?? [];

  return (
    <section className="card">
      <p>
        Este es un resumen de lo que SOEC comprende hoy sobre tu empresa y su entorno. No es una conclusión
        cerrada: cada punto puede desplegarse hasta su evidencia.
      </p>
      <ul className="limpia">
        {p.productoCompuesto.map((linea, i) => (
          <li key={i}>{linea}</li>
        ))}
      </ul>
      <div style={{ marginTop: 10 }}>
        <span className="chip">señales detectadas: {senales.length}</span>
        <span className="chip">contradicciones abiertas: {p.contradiccionesAbiertas.length}</span>
        <span className="chip">faltantes: {p.faltante.length}</span>
        <span className="chip">incertidumbre: {p.incertidumbre}</span>
      </div>
      {p.limitaciones.length > 0 && (
        <div className="aviso small" style={{ marginTop: 12 }}>
          <strong>Limitaciones de esta comprensión:</strong>
          <ul className="limpia">
            {p.limitaciones.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
