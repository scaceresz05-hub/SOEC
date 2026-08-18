'use client';

/**
 * Mis empresas / crear la primera. Muestra SOLO las organizaciones del usuario (la API filtra por sesión).
 * Si no tiene ninguna, ofrece crear una en un paso (el "slug" se genera solo desde el nombre). Al elegir una,
 * fija la empresa activa y lleva al análisis.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearOrganizacion, logout, yo, type UsuarioSesion } from '../../lib/auth-client';
import { fijarOrgActiva } from '../../lib/org-activa';

function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mi-empresa';
}

export default function SelectOrganizationPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<UsuarioSesion | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    const s = await yo();
    if (!s) { router.push('/login'); return; }
    setSesion(s);
    setCargando(false);
  }, [router]);

  useEffect(() => { void cargar(); }, [cargar]);

  function entrar(slug: string): void {
    fijarOrgActiva(slug);
    router.push('/director');
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      const slug = slugify(name);
      await crearOrganizacion(slug, name.trim());
      fijarOrgActiva(slug);
      router.push('/meta'); // recién creada ⇒ conectar Meta
    } catch (err) { setError((err as Error).message); setCreando(false); }
  }

  async function salir() { await logout(); router.push('/login'); }

  if (cargando) return <div className="panel"><p className="muted">Cargando…</p></div>;
  const tiene = (sesion?.organizaciones.length ?? 0) > 0;

  return (
    <div style={{ maxWidth: 560, margin: '30px auto' }} className="panel">
      <p className="muted small">Sesión: {sesion?.user.email} · <a href="#" onClick={(e) => { e.preventDefault(); void salir(); }}>cerrar sesión</a></p>

      {tiene && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Tus empresas</h2>
          {sesion?.organizaciones.map((o) => (
            <div key={o.slug} className="srcrow" style={{ marginBottom: 6 }}>
              <span className="sico" aria-hidden="true">🏢</span>
              <div style={{ minWidth: 0 }}><div className="st">{o.name}</div><div className="ss">{o.role}</div></div>
              <button className="btn primary" onClick={() => entrar(o.slug)}>Entrar →</button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={crear} className="card">
        <h2>{tiene ? 'Crear otra empresa' : 'Creá tu empresa para empezar'}</h2>
        <p className="muted small">Sólo necesitamos el nombre. Lo demás lo configuramos nosotros.</p>
        <label style={{ display: 'block', margin: '10px 0' }}>
          Nombre de la empresa<br />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: SmileFlow Clinic" style={{ width: '100%' }} required />
        </label>
        {name.trim() && <p className="small muted">Se creará como <code>{slugify(name)}</code> · serás el propietario (OWNER).</p>}
        {error && <div className="aviso aviso--danger" style={{ margin: '8px 0' }}>{error}</div>}
        <button className="btn primary" type="submit" disabled={!name.trim() || creando}>{creando ? 'Creando…' : 'Crear empresa'}</button>
      </form>
    </div>
  );
}
