'use client';

/**
 * Administración de organización. La API es la autoridad: cada acción se valida por sesión +
 * membresía + permisos efectivos (401/403/404 según corresponda). La UI oculta lo que el rol no
 * puede hacer, pero NO es la barrera de seguridad. Secciones: miembros/roles, invitaciones,
 * seguridad (modo operativo, nombre, contraseña) y auditoría.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { yo } from '../../../lib/auth-client';
import {
  cambiarModo,
  cambiarPassword,
  cambiarRol,
  detalleOrg,
  invitar,
  listarAuditoria,
  listarMiembros,
  MODOS,
  renombrarOrg,
  revocarMiembro,
  ROLES_ASIGNABLES,
  type EventoAuditoria,
  type Miembro,
  type OrgDetalle,
} from '../../../lib/admin-client';

export default function AdminOrgPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [org, setOrg] = useState<OrgDetalle | null>(null);
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [auditoria, setAuditoria] = useState<EventoAuditoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const puede = (p: string): boolean => !!org && org.permisos.includes(p);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const sesion = await yo();
      if (!sesion) { router.push('/login'); return; }
      const d = await detalleOrg(slug);
      setOrg(d);
      if (d.permisos.includes('members.read')) setMiembros((await listarMiembros(slug)).miembros);
      if (d.permisos.includes('audit.read')) setAuditoria((await listarAuditoria(slug)).eventos);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, [slug, router]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function accion(fn: () => Promise<unknown>, ok: string) {
    setError(null); setAviso(null);
    try { await fn(); setAviso(ok); await cargar(); }
    catch (err) { setError((err as Error).message); }
  }

  if (cargando) return <p className="muted">Cargando…</p>;
  if (!org) return <div className="aviso aviso--danger">{error ?? 'No se pudo cargar la organización.'}</div>;

  return (
    <div style={{ maxWidth: 820, margin: '24px auto' }}>
      <p className="muted small"><a href="/select-organization">← Organizaciones</a></p>
      <h1>{org.name}</h1>
      <p className="muted small">
        <span className="chip">{org.slug}</span> <span className="chip">{org.role}</span> <span className="chip">modo: {org.operationalMode}</span>
      </p>
      {error && <div className="aviso aviso--danger" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="aviso" style={{ marginBottom: 12 }}>{aviso}</div>}

      <SeccionMiembros org={org} miembros={miembros} puede={puede} accion={accion} />
      <SeccionSeguridad org={org} puede={puede} accion={accion} />
      {puede('audit.read') && <SeccionAuditoria eventos={auditoria} />}
    </div>
  );
}

function SeccionMiembros({ org, miembros, puede, accion }: { org: OrgDetalle; miembros: Miembro[]; puede: (p: string) => boolean; accion: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('VIEWER');
  const [devToken, setDevToken] = useState<string | null>(null);
  if (!puede('members.read')) return null;
  const gestiona = puede('members.manage');
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Miembros y roles</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Email</th><th>Rol</th><th>Estado</th>{gestiona && <th>Acciones</th>}</tr></thead>
        <tbody>
          {miembros.map((m) => (
            <tr key={m.membershipId}>
              <td>{m.email}</td>
              <td>
                {gestiona && m.role !== 'OWNER' ? (
                  <select defaultValue={m.role} onChange={(e) => void accion(() => cambiarRol(org.slug, m.membershipId, e.target.value), 'Rol actualizado')}>
                    {ROLES_ASIGNABLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : <span className="chip">{m.role}</span>}
              </td>
              <td><span className="chip">{m.status}</span></td>
              {gestiona && <td>{m.role !== 'OWNER' && m.status === 'ACTIVE' && <button className="btn btn--danger" onClick={() => void accion(() => revocarMiembro(org.slug, m.membershipId), 'Miembro revocado')}>Revocar</button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {puede('members.invite') && (
        <form
          style={{ marginTop: 12 }}
          onSubmit={(e) => { e.preventDefault(); void accion(async () => { const r = await invitar(org.slug, email, role); setDevToken(r.devToken ?? null); setEmail(''); }, 'Invitación creada'); }}
        >
          <h3>Invitar</h3>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />{' '}
          <select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES_ASIGNABLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>{' '}
          <button className="btn" type="submit">Invitar</button>
          {devToken && <p className="muted small" style={{ marginTop: 8 }}>Token de invitación (dev, entregar fuera de banda): <code>{devToken}</code></p>}
        </form>
      )}
    </section>
  );
}

function SeccionSeguridad({ org, puede, accion }: { org: OrgDetalle; puede: (p: string) => boolean; accion: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [nombre, setNombre] = useState(org.name);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Seguridad y modo operativo</h2>

      {puede('operational_mode.manage') && (
        <div style={{ marginBottom: 12 }}>
          <h3>Modo operativo</h3>
          <p className="muted small">PILOT: simulado, sin canales ni gasto. SUPERVISED_REAL: borradores reales con aprobación humana. AUTONOMOUS_REAL está bloqueado por diseño.</p>
          {MODOS.map((m) => (
            <button key={m} className="btn" disabled={org.operationalMode === m} style={{ marginRight: 8 }} onClick={() => void accion(() => cambiarModo(org.slug, m), `Modo → ${m}`)}>{m}</button>
          ))}
        </div>
      )}

      {puede('organization.manage') && (
        <form style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); void accion(() => renombrarOrg(org.slug, nombre), 'Nombre actualizado'); }}>
          <h3>Nombre de la organización</h3>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />{' '}
          <button className="btn" type="submit">Guardar</button>
        </form>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void accion(async () => { await cambiarPassword(actual, nueva); setActual(''); setNueva(''); }, 'Contraseña cambiada; volvé a iniciar sesión'); }}>
        <h3>Cambiar mi contraseña</h3>
        <p className="muted small">Al cambiarla se cierran todas tus sesiones.</p>
        <input type="password" placeholder="actual" value={actual} onChange={(e) => setActual(e.target.value)} required />{' '}
        <input type="password" placeholder="nueva (≥8)" value={nueva} onChange={(e) => setNueva(e.target.value)} required />{' '}
        <button className="btn" type="submit">Cambiar</button>
      </form>
    </section>
  );
}

function SeccionAuditoria({ eventos }: { eventos: EventoAuditoria[] }) {
  return (
    <section className="card">
      <h2>Auditoría</h2>
      {eventos.length === 0 && <p className="muted">Sin eventos.</p>}
      <ul className="small" style={{ listStyle: 'none', padding: 0 }}>
        {eventos.map((e) => (
          <li key={e.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border, #eee)' }}>
            <span className="chip">{e.result}</span> <strong>{e.action}</strong>{' '}
            <span className="muted">{e.resourceType ?? ''} · {new Date(e.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
