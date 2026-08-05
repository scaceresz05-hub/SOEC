import Link from 'next/link';
import { redirect } from 'next/navigation';
import { decisiones } from '../../lib/soec/consultas';

export const dynamic = 'force-dynamic';

export default async function Explicaciones() {
  const items = await decisiones();
  if (items.length > 0) redirect(`/explicaciones/${items[0]!.id}`);
  return (
    <div className="wrap panel">
      <p className="eyebrow">Por qué</p>
      <h1 className="voice">Cada cosa que hago, la explico.</h1>
      <p className="lede">Ahora mismo no hay ninguna recomendación pendiente que explicarte. Cuando la haya, aquí verás qué hice, por qué, qué evidencia usé y qué descarté.</p>
      <div className="foot"><Link href="/">← Volver al inicio</Link></div>
    </div>
  );
}
