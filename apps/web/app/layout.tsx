import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import BusinessSelector from '../components/BusinessSelector';

export const metadata = {
  title: 'SOEC — Tu Director de Marketing',
  description:
    'SOEC dirige tus negocios: mira tus datos, te dice cómo va cada uno y qué conviene hacer. Tú decides; del resto se ocupa SOEC.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <div className="inner">
            <Link href="/" className="brand" aria-label="SOEC — inicio">
              <span className="dot" aria-hidden="true" />
              <span>
                SOEC<small>Dirección de Marketing</small>
              </span>
            </Link>
            <BusinessSelector />
            <nav className="mainnav" aria-label="Principal">
              <Link href="/">Mis empresas</Link>
              <Link href="/negocios">Panel del negocio</Link>
              <Link href="/autonomia">Nivel de control</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="pie">
          SOEC está en <b>modo seguro</b>: observa tus datos, te explica y te propone. No publica, no
          gasta ni cambia nada real sin tu aprobación.
        </footer>
      </body>
    </html>
  );
}
