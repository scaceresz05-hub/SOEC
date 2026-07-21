import type { ResultadoExperiencia } from '../lib/types';

/** Sección especialmente visible: lo que queda reservado al juicio de la persona. */
export function AsuntosReservados({ r }: { r: ResultadoExperiencia }) {
  const p = r.producto;
  if (!p) return null;
  return (
    <section className="card reserved">
      <h2>Lo que debes revisar o decidir personalmente</h2>
      <p className="small muted">SOEC no tomó ninguna decisión por ti y no ejecutó ninguna acción.</p>

      {p.contradiccionesAbiertas.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3>Contradicciones que requieren tu revisión</h3>
          <ul className="limpia">
            {p.contradiccionesAbiertas.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {p.faltante.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3>Información que conviene validar o conseguir</h3>
          <ul className="limpia">
            {p.faltante.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <h3>Cuestiones reservadas a tu juicio</h3>
        <ul className="limpia">
          {p.cuestionesJuicioHumano.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </div>

      <p className="small muted" style={{ marginTop: 12 }}>
        Esta pantalla no ofrece botones para aprobar, ejecutar, publicar, enviar ni resolver: esas acciones son tuyas.
      </p>
    </section>
  );
}
