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
            <Link href="/control">Centro de control</Link>
            <Link href="/">Estado de la empresa</Link>
            <Link href="/marketing">Marketing</Link>
            <Link href="/contenido">Contenido</Link>
            <Link href="/canales">Publicación</Link>
            <Link href="/medicion">Medición</Link>
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
