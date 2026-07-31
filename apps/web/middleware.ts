import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Redirección de UX para páginas protegidas: si no hay cookie de sesión, va a /login. Esto es una
 * comodidad de interfaz — la AUTORIDAD final es la API (que responde 401 sin sesión válida). La
 * presencia de la cookie no implica validez; la API la verifica.
 */
export function middleware(req: NextRequest): NextResponse {
  if (!req.cookies.get('soec_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/select-organization/:path*', '/settings/:path*'],
};
