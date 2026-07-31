'use client';

/**
 * Selección de organización. Muestra SOLO las organizaciones donde el usuario tiene membresía
 * activa (la API filtra por sesión). Si no tiene ninguna, permite crear una (queda como OWNER).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearOrganizacion, logout, yo, type UsuarioSesion } from '../../lib/auth-client';

export default function SelectOrganizationPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<UsuarioSesion | null>(null);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    const s = await yo();
    if (!s) { router.push('/login'); return; }
    setSesion(s);
    setCargando(false);
  }, [router]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await crearOrganizacion(slug, name);
      await cargar();
      setSlug(''); setName('');
    } catch (err) { setError((err as Error).message); }
  }

  async function salir() {
    await logout();
    router.push('/login');
  }

  if (cargando) return <p className="muted">Cargando…</p>;

  return (
    <div style={{ maxWidth: 560, margin: '30px auto' }}>
      <h1>Seleccionar organización</h1>
      <p className="muted small">Sesión: {sesion?.user.email} · <a href="#" onClick={(e) => { e.preventDefault(); void salir(); }}>cerrar sesión</a></p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Tus organizaciones</h2>
        {sesion && sesion.organizaciones.length === 0 && <p className="muted">No tenés organizaciones. Creá una para empezar.</p>}
        {sesion?.organizaciones.map((o) => (
          <div key={o.slug} style={{ marginBottom: 6 }}>
            <button className="btn" onClick={() => router.push(`/director-autonomo/programas?org=${encodeURIComponent(o.slug)}`)}>
              {o.name}
            </button>{' '}
            <a className="chip" href={`/organizaciones/${encodeURIComponent(o.slug)}`}>Administrar</a>{' '}
            <span className="chip">{o.role}</span>
            <span className="chip">{o.operationalMode}</span>
          </div>
        ))}
      </div>

      <form onSubmit={crear} className="card">
        <h2>Crear organización</h2>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Slug (minúsculas, guiones)<br />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ width: '100%' }} required />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Nombre<br />
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} required />
        </label>
        {error && <div className="aviso aviso--danger" style={{ marginBottom: 8 }}>{error}</div>}
        <button className="btn" type="submit">Crear (seré OWNER)</button>
      </form>
    </div>
  );
}
