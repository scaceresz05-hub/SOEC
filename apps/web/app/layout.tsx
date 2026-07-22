import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: 'SOEC — Comprender el estado de mi empresa',
  description: 'SOEC informa y estructura; la decisión final corresponde a la persona.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            SOEC
          </Link>
          <nav>
            <Link href="/">Estado de la empresa</Link>
            <Link href="/historial">Historial de análisis</Link>
            <Link href="/marketing">Marketing autónomo</Link>
            <Link href="/contenido">Fábrica de contenido</Link>
            <Link href="/canales">Publicación controlada</Link>
            <Link href="/medicion">Medición y optimización</Link>
          </nav>
        </header>
        <main className="contenido">{children}</main>
        <footer className="pie">
          SOEC informa y estructura. La decisión y la acción son de la persona.
        </footer>
      </body>
    </html>
  );
}
