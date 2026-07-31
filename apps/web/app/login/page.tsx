'use client';

/**
 * Login / registro. La sesión se establece por cookie httpOnly (la maneja la API); esta página no
 * guarda tokens. La API es la autoridad final de autenticación.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, registrar } from '../../lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      if (modo === 'registro') {
        await registrar(email, displayName, password);
      }
      await login(email, password);
      router.push('/select-organization');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '40px auto' }}>
      <h1>SOEC · {modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
      <div className="aviso" style={{ marginBottom: 12 }}>
        Entorno piloto con datos sintéticos. Esta versión no dispone de canales reales; todo
        resultado es simulado.
      </div>
      <form onSubmit={enviar} className="card">
        {modo === 'registro' && (
          <label style={{ display: 'block', marginBottom: 8 }}>
            Nombre<br />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: '100%' }} required />
          </label>
        )}
        <label style={{ display: 'block', marginBottom: 8 }}>
          Email<br />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} required />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Contraseña<br />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} minLength={8} required />
        </label>
        {error && <div className="aviso aviso--danger" style={{ marginBottom: 8 }}>{error}</div>}
        <button className="btn" type="submit" disabled={cargando}>{modo === 'login' ? 'Entrar' : 'Crear cuenta y entrar'}</button>
      </form>
      <p className="small" style={{ marginTop: 10 }}>
        {modo === 'login' ? (
          <>¿No tenés cuenta? <a href="#" onClick={(e) => { e.preventDefault(); setModo('registro'); }}>Crear una</a></>
        ) : (
          <>¿Ya tenés cuenta? <a href="#" onClick={(e) => { e.preventDefault(); setModo('login'); }}>Iniciar sesión</a></>
        )}
      </p>
    </div>
  );
}
