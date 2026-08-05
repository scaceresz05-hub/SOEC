import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { decisiones } from '../lib/soec/consultas';

export const metadata = {
  title: 'SOEC — Tu Director de Marketing',
  description: 'SOEC trabaja por tus objetivos. Tú defines el rumbo y apruebas las decisiones; del resto se ocupa SOEC.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  let pendientes = 0;
  try { pendientes = (await decisiones()).length; } catch { pendientes = 0; }
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <div className="inner">
            <Link href="/" className="brand">
              <span className="dot" aria-hidden="true" />
              <span>SOEC<small>Dirección de Marketing</small></span>
            </Link>
            <nav className="mainnav" aria-label="Principal">
              <Link href="/">Inicio</Link>
              <Link href="/decisiones">Decisiones{pendientes > 0 && <span className="badge">·{pendientes}</span>}</Link>
              <Link href="/explicaciones">Por qué</Link>
            </nav>
          </div>
        </header>
        <nav className="subnav" aria-label="Configuración">
          <div className="row">
            <Link href="/objetivos">Objetivos</Link>
            <Link href="/autonomia">Autonomía</Link>
            <Link href="/onboarding">Poner en marcha</Link>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="pie">
          SOEC trabaja en modo simulado: propone y explica; tú decides. Nada se publica, gasta ni ejecuta de forma real.
        </footer>
      </body>
    </html>
  );
}
