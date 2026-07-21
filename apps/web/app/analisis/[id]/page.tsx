import Link from 'next/link';
import { API_BASE } from '../../../lib/config';
import type { ResultadoExperiencia } from '../../../lib/types';
import { Resultado } from '../../../components/Resultado';

async function cargar(id: string): Promise<{ r: ResultadoExperiencia | null; error: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/experiencia/comprender-estado/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === 404) return { r: null, error: false };
    const data = (await res.json()) as ResultadoExperiencia;
    return { r: data, error: false };
  } catch {
    return { r: null, error: true };
  }
}

export default async function DetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { r, error } = await cargar(id);
  return (
    <div>
      <p className="small">
        <Link href="/historial">← Historial de análisis</Link>
      </p>
      <h1>Análisis del estado</h1>
      {error && <section className="card"><div className="aviso aviso--danger small">No se pudo cargar este análisis. Reintenta más tarde.</div></section>}
      {!error && !r && (
        <section className="card">
          <p className="muted">No se encontró este análisis. Puede que no exista o haya sido consultado con un identificador incorrecto.</p>
        </section>
      )}
      {r && <Resultado r={r} />}
    </div>
  );
}
