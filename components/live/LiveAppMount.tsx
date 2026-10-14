/**
 * LiveAppMount (owner W6-live) — the one place LiveEventsProvider is mounted.
 * Render it ONCE in pages/_app.tsx, next to <Toaster/>: being above the page
 * component, it survives client-side navigation (AppLayout is rendered inside
 * each page, so a provider there would unmount on every route change, drop the
 * stream lock and any pending new-order chime).
 *
 * Opens the stream only for a signed-in user on /app/* routes (public and
 * marketing pages never open one), and scopes it to that user's id.
 */
import React from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import LiveEventsProvider from './LiveEventsProvider';

export type LiveAppMountProps = {
  /** Route prefixes where the stream is open. Default ['/app']. */
  pathPrefixes?: string[];
  ordersPath?: string;
};

export function isLivePath(pathname: string | null | undefined, prefixes: readonly string[]): boolean {
  if (!pathname) return false;
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const DEFAULT_PREFIXES = ['/app'];

export default function LiveAppMount({ pathPrefixes = DEFAULT_PREFIXES, ordersPath = '/app/labels' }: LiveAppMountProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const enabled = status === 'authenticated' && Boolean(userId) && isLivePath(router?.pathname, pathPrefixes);
  return <LiveEventsProvider enabled={enabled} userId={userId} ordersPath={ordersPath} />;
}
