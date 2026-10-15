// lib/nav/shellRoutes.ts — which routes get the persistent AppShell (shell-nav §12 F, §0).
//
// `/app/**` except the print views (`/app/print/**`, printed without chrome), plus `/ayarlar` and
// `/faturalar`. Everything else (marketing, auth, legal, 404, _error, logout) renders without the shell.
// Matched on the Next.js route pattern (`router.pathname`, e.g. `/app/etsy-listings/[id]`), so a query or
// a dynamic segment never changes the answer and client navigation between app routes keeps one shell.

const EXACT = new Set(['/ayarlar', '/faturalar']);

export function isShellRoute(pathname: string | null | undefined): boolean {
  const p = String(pathname ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (EXACT.has(p)) return true;
  if (p === '/app/print' || p.startsWith('/app/print/')) return false;
  return p === '/app' || p.startsWith('/app/');
}
