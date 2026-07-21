import Link from 'next/link';
import { API_BASE } from '../../lib/config';
import type { ResumenHistorial } from '../../lib/types';

async function cargar(): Promise<{ items: ResumenHistorial[]; error: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/experiencia/comprender-estado/historial`, { cache: 'no-store' });
    const data = (await res.json()) as { historial?: ResumenHistorial[] };
    return { items: data.historial ?? [], error: false };
  } catch {
    return { items: [], error: true };
  }
}

function fecha(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CL');
  } catch {
    return iso;
  }
}

export default async function HistorialPage() {
  const { items, error } = await cargar();
  return (
    <div>
      <h1>Historial de análisis</h1>
      {error && (
        <section className="card">
          <div className="aviso aviso--danger small">No se pudo consultar el historial ahora. Recarga para reintentar.</div>
        </section>
      )}
      {!error && items.length === 0 && (
        <section className="card">
          <p className="muted">Aún no hay análisis. Vuelve a <Link href="/">Estado de la empresa</Link> para generar el primero.</p>
        </section>
      )}
      {items.map((h) => (
        <section className="card" key={h.executionId}>
          <div className="kv">
            <dt>Momento</dt>
            <dd>{fecha(h.terminadoEn)}</dd>
            <dt>Estado</dt>
            <dd>{h.estado === 'compuesta' ? 'comprensión disponible' : h.estado}</dd>
            <dt>Puntos abiertos</dt>
            <dd>
              <span className="chip">contradicciones: {h.contradicciones}</span>
              <span className="chip">faltantes: {h.faltantes}</span>
            </dd>
          </div>
          <p style={{ marginTop: 8 }}>
            <Link href={`/analisis/${encodeURIComponent(h.executionId)}`}>Ver este análisis →</Link>
          </p>
        </section>
      ))}
    </div>
  );
}
