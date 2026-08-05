import Link from 'next/link';
import { decisiones } from '../../lib/soec/consultas';
import { aprobar, rechazar } from './actions';

export const dynamic = 'force-dynamic';

export default async function Decisiones() {
  const items = await decisiones();
  return (
    <div className="wrap panel">
      <p className="eyebrow">Bandeja de decisiones</p>
      <h1 className="voice">Sólo lo que requiere tu criterio.</h1>
      <p className="lede">Aquí no hay tareas ni operaciones — sólo decisiones que necesitan a una persona. Del resto me ocupo yo.</p>

      {items.length === 0 ? (
        <div className="salud normal"><span className="dotb" aria-hidden="true" />
          <span><span className="t">No tienes nada pendiente</span> — <span className="s">Cuando necesite tu criterio, lo verás aquí.</span></span></div>
      ) : (
        <div className="stack">
          {items.map((d) => (
            <article className="card decision" key={d.id}>
              <span className="pill warn">{d.etiqueta}</span>
              <h3>{d.titulo}</h3>
              <p className="why">{d.porque}</p>
              <div className="actions">
                <form action={aprobar.bind(null, d.id)}><button className="btn primary" type="submit">Aprobar</button></form>
                <form action={rechazar.bind(null, d.id)}><button className="btn" type="submit">Rechazar</button></form>
                <Link href={`/explicaciones/${d.id}`} className="btn ghost">Más información</Link>
              </div>
              <div className="foot">
                Al aprobar, preparo la nueva versión del plan para el siguiente paso. · <Link href={`/explicaciones/${d.id}`}>Ver la explicación completa →</Link>
              </div>
            </article>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <p className="lede" style={{ fontSize: '14.5px', marginTop: '16px' }}>
          ¿Prefieres no decidir esto ahora? Puedo esperar sin bloquear el resto de tu trabajo — no me quedo
          detenido. Y si quieres que en casos como este actúe sin preguntarte, súbeme la{' '}
          <Link href="/autonomia">autonomía</Link> y me ocupo yo dentro de tus políticas.
        </p>
      )}
      <p className="sim">SOEC se <b>abstiene</b> cuando la evidencia no alcanza: sólo te trae decisiones cuando de verdad las necesita.</p>
    </div>
  );
}
