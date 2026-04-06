// Middleware is no longer needed for session management.
// NextAuth handles sessions via HTTP-only cookies automatically.
// This file is kept as a no-op to avoid breaking the matcher config.

import { NextResponse } from 'next/server';

export async function middleware(req) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|api/auth|api/ebay|api/integrations/ebay|public|images|assets).*)',
  ],
};
