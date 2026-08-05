import Link from 'next/link';
import { explicacion } from '../../../lib/soec/consultas';

export const dynamic = 'force-dynamic';

export default async function Explicacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exp = await explicacion(id);
  if (!exp) {
    return (
      <div className="wrap panel">
        <p className="eyebrow">Por qué</p>
        <h1 className="voice">No encuentro esa explicación.</h1>
        <p className="lede">Puede que la decisión ya se haya resuelto. <Link href="/decisiones" className="foot">Volver a decisiones →</Link></p>
      </div>
    );
  }
  return (
    <div className="wrap panel">
      <p className="eyebrow">Por qué lo recomiendo</p>
      <h1 className="voice">{exp.titulo}</h1>
      <p className="lede">Toda recomendación mía viene con su razonamiento completo. Si algo no te convence, aquí está el detalle.</p>
      <div className="card">
        <dl className="exp">
          {exp.filas.map((f, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt>{f.k}</dt>
              <dd className={'tono' in f && f.tono === 'pos' ? 'pos' : 'tono' in f && f.tono === 'neg' ? 'neg' : undefined}>{f.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="note" style={{ marginTop: 16 }}>
        Una correlación no es causalidad y una mejora simulada no es evidencia de mejora real. Por eso propongo repetir, no dar por cerrado.
      </div>
      <div className="foot"><Link href="/decisiones">← Volver a la decisión</Link></div>
    </div>
  );
}
