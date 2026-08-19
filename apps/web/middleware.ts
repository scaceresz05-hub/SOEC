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
  // Punto de entrada único: TODA ruta de aplicación exige sesión (sin sesión → /login), salvo las
  // superficies PÚBLICAS por diseño: /login, /legal/*, /soporte, /eliminacion-datos/* (callback Meta),
  // el proxy /api/*, y los assets de Next. Así el usuario entra por la raíz y es llevado al flujo correcto
  // sin conocer rutas técnicas. La API sigue siendo la autoridad final (401 sin sesión válida).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login|legal|soporte|eliminacion-datos).*)'],
};
