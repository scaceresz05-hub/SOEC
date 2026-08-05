import { objetivos } from '../../lib/soec/consultas';

export const dynamic = 'force-dynamic';

export default async function Objetivos() {
  const items = await objetivos();
  return (
    <div className="wrap panel">
      <p className="eyebrow">Tus objetivos</p>
      <h1 className="voice">Trabajo para cumplir objetivos.</h1>
      <p className="lede">No para lanzar campañas ni anuncios. Tú fijas la meta; yo elijo cómo alcanzarla, la ejecuto (simulado), la mido y te muestro el avance.</p>
      <div className="card">
        {items.map((o, i) => (
          <div className="obj" key={i}>
            <div className="name">{o.nombre}</div>
            <div className="meta">{o.metaTexto}</div>
            <div className="track"><i style={{ width: `${o.avance}%` }} /></div>
            <div className="val">{o.valor}</div>
            <div className="meta"><span className={`pill ${o.estado === 'en_marcha' ? 'ok' : 'mut'}`} style={{ fontSize: '10.5px' }}>{o.estado === 'en_marcha' ? 'En marcha' : 'Midiendo'}</span></div>
          </div>
        ))}
      </div>
      <p className="lede" style={{ fontSize: '14.5px', marginTop: '16px' }}>
        Cuando tienes varios objetivos, avanzo cada uno según la evidencia que voy reuniendo: primero el que ya
        está listo para decidir. Si dos compiten por el mismo presupuesto, no elijo a tus espaldas — te lo traigo
        como una decisión.
      </p>
      <p className="sim">La forma de medir cada objetivo la elijo yo y la sigo con evidencia. No te pido que decidas <b>qué medir</b>.</p>
    </div>
  );
}
