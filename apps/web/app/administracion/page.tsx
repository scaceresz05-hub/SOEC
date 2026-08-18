'use client';

/**
 * Punto de entrada org-aware a la administración de la empresa (equipo, roles, invitaciones, auditoría).
 * Resuelve la empresa activa y redirige a /organizaciones/{slug} — el usuario nunca tipea el slug.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { orgActiva } from '../../lib/org-activa';

export default function AdministracionPage(): React.ReactElement {
  const router = useRouter();
  useEffect(() => {
    const o = orgActiva();
    router.replace(o ? `/organizaciones/${o}` : '/select-organization');
  }, [router]);
  return <div className="wrap"><p className="mut">Abriendo la administración de tu empresa…</p></div>;
}
