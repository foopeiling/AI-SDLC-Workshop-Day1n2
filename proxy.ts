import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/session-token';

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const pathname = request.nextUrl.pathname;

  if (pathname === '/login' && session) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if ((pathname === '/' || pathname.startsWith('/calendar')) && !session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/calendar/:path*', '/login'],
};