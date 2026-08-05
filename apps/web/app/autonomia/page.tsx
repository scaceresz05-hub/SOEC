export const dynamic = 'force-dynamic';

const NIVELES = [
  { t: 'Solo observar', s: 'Miro y aprendo. No propongo nada.', tag: 'Mínimo', tagc: 'mut' },
  { t: 'Recomendar', s: 'Te traigo propuestas; tú decides todo.', tag: 'Prudente', tagc: 'mut' },
  { t: 'Ejecutar con tu aprobación', s: 'Preparo los cambios y los aplico cuando das el visto bueno.', tag: 'Actual', tagc: 'ok', on: true },
  { t: 'Ejecutar automáticamente', s: 'Actúo solo dentro de tus políticas; te aviso de excepciones y riesgos.', tag: 'Máximo', tagc: 'warn' },
];

export default function Autonomia() {
  return (
    <div className="wrap panel">
      <p className="eyebrow">Cuánto quieres delegarme</p>
      <h1 className="voice">¿Cuánto me dejas decidir solo?</h1>
      <p className="lede">Tú fijas el límite. Puedo sólo mirar, recomendarte, actuar con tu visto bueno, o actuar solo dentro de tus políticas. Puedes cambiarlo cuando quieras.</p>
      <div role="radiogroup" aria-label="Nivel de autonomía">
        {NIVELES.map((n, i) => (
          <div className={`lvl ${n.on ? 'on' : ''}`} key={i} role="radio" aria-checked={n.on ? 'true' : 'false'}>
            <span className="radio" aria-hidden="true" />
            <span><span className="lt">{n.t}</span><span className="ls">{n.s}</span></span>
            <span className={`pill ${n.tagc}`}>{n.tag}</span>
          </div>
        ))}
      </div>
      <div className="note" style={{ marginTop: 18 }}>
        Sea cual sea el nivel, cualquier acción con efecto real seguirá exigiendo tu ratificación. Hoy todo ocurre en modo simulado; el nivel se gobierna con la misma infraestructura de autonomía de SOEC.
      </div>
    </div>
  );
}
