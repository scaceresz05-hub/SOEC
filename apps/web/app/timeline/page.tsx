import { timeline } from '../../lib/soec/consultas';

export const dynamic = 'force-dynamic';

export default async function Timeline() {
  const { items } = await timeline();
  return (
    <div className="wrap panel">
      <p className="eyebrow">Actividad</p>
      <h1 className="voice">Lo que hice, como si revisaras a un empleado.</h1>
      <p className="lede">Un registro claro de qué hice, qué aprendí y qué decidimos — para que puedas revisar mi trabajo cuando quieras.</p>
      <div className="card" style={{ padding: '6px 16px' }}>
        {items.map((it, i) => (
          <div className="did" key={i}>
            <span className="tick medi" aria-hidden="true">•</span>
            <div><p className="t" style={{ margin: 0 }}>{it.titulo}</p><p className="s" style={{ margin: 0 }}>{it.detalle}</p></div>
            <time>{it.cuando}</time>
          </div>
        ))}
      </div>
      <p className="sim">Todo es <b>SIMULADO</b>. Estos hechos los reconstruyo de mi propia memoria de decisiones y ejecuciones.</p>
    </div>
  );
}
