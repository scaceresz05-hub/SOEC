import Link from 'next/link';
import { inicio } from '../lib/soec/consultas';

export const dynamic = 'force-dynamic';

const HORA = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
};
const ICON: Record<string, string> = { ok: '✓', aprendi: '✦', medi: '↻' };

export default async function Home() {
  const { hecho, decisiones, objetivos, salud } = await inicio();
  return (
    <div className="wrap panel">
      <p className="eyebrow">{new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 className="voice">{HORA()}.</h1>
      <p className="lede">
        {decisiones.length > 0
          ? `Mientras no estabas avancé en tus objetivos y dejé ${decisiones.length} decisión${decisiones.length > 1 ? 'es' : ''} que sólo tú puedes tomar.`
          : 'Mientras no estabas avancé en tus objetivos. No necesito nada de ti ahora mismo.'}
      </p>

      <div className={`salud ${salud.estado}`}>
        <span className="dotb" aria-hidden="true" />
        <span><span className="t">{salud.titulo}</span> — <span className="s">{salud.detalle}</span></span>
      </div>

      <h2 className="block">Lo que hice por ti</h2>
      <div className="card" style={{ padding: '6px 16px' }}>
        {hecho.map((h, i) => (
          <div className="did" key={i}>
            <span className={`tick ${h.icono}`} aria-hidden="true">{ICON[h.icono]}</span>
            <div><p className="t" style={{ margin: 0 }}>{h.titulo}</p><p className="s" style={{ margin: 0 }}>{h.detalle}</p></div>
            <time>{h.cuando}</time>
          </div>
        ))}
      </div>

      {decisiones.length > 0 && (
        <>
          <h2 className="block">Necesito tu decisión</h2>
          <div className="stack">
            {decisiones.map((d) => (
              <article className="card decision" key={d.id}>
                <span className="pill warn">{d.etiqueta}</span>
                <h3>{d.titulo}</h3>
                <p className="why">{d.porque}</p>
                <div className="foot">
                  <Link href="/decisiones">Revisar y decidir →</Link>
                  <span>·</span>
                  <Link href={`/explicaciones/${d.id}`}>Ver por qué lo recomiendo</Link>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <h2 className="block">Tus objetivos</h2>
      <div className="card">
        {objetivos.map((o, i) => (
          <div className="obj" key={i}>
            <div className="name">{o.nombre}</div>
            <div className="meta">{o.metaTexto}</div>
            <div className="track"><i style={{ width: `${o.avance}%` }} /></div>
            <div className="val">{o.valor}</div>
            <div className="meta"><span className={`pill ${o.estado === 'en_marcha' ? 'ok' : 'mut'}`} style={{ fontSize: '10.5px' }}>{o.estado === 'en_marcha' ? 'En marcha' : 'Midiendo'}</span></div>
          </div>
        ))}
      </div>

      <p className="sim">Datos <b>SIMULADOS</b>, calculados por los propios motores de SOEC. Nada se publica, gasta ni ejecuta de forma real.</p>
    </div>
  );
}
