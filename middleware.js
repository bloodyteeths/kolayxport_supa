// First-party referral / first-touch cookies (docs/gtm/referral-spec.md §2.1, lib/partners/cookies.ts).
// Sets kx_ref (from ?ref=) and kx_ft (first utm_* touch) on page GETs only, never overwriting an existing one.
// No DB access, no redirects. NextAuth sessions are untouched: /api/*, /auth, /oauth (MCP consent), /.well-known and
// assets are skipped here and in the matcher below.

import { NextResponse } from 'next/server';
import {
  ATTR_MAX_AGE,
  FT_COOKIE,
  REF_COOKIE,
  buildFtCookieValue,
  buildRefCookieValue,
  firstTouchFromUrl,
  normalizeRefCode,
  shouldCaptureRequest,
} from './lib/partners/cookies';

const COOKIE_OPTS = { path: '/', maxAge: ATTR_MAX_AGE, sameSite: 'lax', secure: true, httpOnly: true };

export async function middleware(req) {
  const res = NextResponse.next();
  try {
    const url = req.nextUrl;
    if (!url.search || !shouldCaptureRequest(req.method, url.pathname, req.headers.get('user-agent'))) return res;
    const nowSec = Math.floor(Date.now() / 1000);
    const code = normalizeRefCode(url.searchParams.get('ref'));
    if (code && !req.cookies.get(REF_COOKIE)) {
      res.cookies.set(REF_COOKIE, buildRefCookieValue(code, nowSec), COOKIE_OPTS);
    }
    if (!req.cookies.get(FT_COOKIE)) {
      const ft = firstTouchFromUrl(url, nowSec);
      const value = ft && buildFtCookieValue(ft);
      if (value) res.cookies.set(FT_COOKIE, value, COOKIE_OPTS);
    }
  } catch {
    /* attribution must never break a page */
  }
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|api|oauth|\\.well-known|public|images|assets).*)',
  ],
};
