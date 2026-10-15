// lib/nav/ShellContext.tsx — how pages hand their meta to the persistent shell (shell-nav §6.1, §14.4).
//
// `AppShell` (group C) renders <ShellProvider>. A page supplies its meta in one of two ways:
//   1. `<Page …>` (components/ds/page/Page.tsx, wired by group F): `onShellMetaChange={usePageMetaSink()}`.
//      The sink stores the full `PageShellMeta` (title, breadcrumbs, backHref, mobileAction, mobileOverflow,
//      headerActions) and clears it when that page unmounts.
//   2. The legacy `AppLayout` shim (group F): `usePageTitle(stripTitleSuffix(title))`. Title only; used until
//      every page renders `<Page>` (M10 deletes the shim).
// When both exist, the `<Page>` meta wins.
//
// Readers: `TopBar` (breadcrumbs), `MobileTopBar` (title, back, mobileAction, ⋯ = mobileOverflow),
// `CommandPalette` (headerActions → "On this page"). `ShellProvider` writes `<title>` from the merged title
// ("{title} · KolayXport", key `ds.page.documentTitle`, the same string `<Page>` writes).
import * as React from 'react';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import type { PageShellMeta } from '@/components/ds/page/PageContext';
import type { PageBreadcrumb, PageWidth } from '@/components/ds/page/types';
import type { ActionSpec } from '@/components/ds/types/actions';

export type { PageShellMeta };

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/** Merged meta the shell reads. `source` says where it came from. */
export type ShellPageMeta = {
  title: string;
  width?: PageWidth;
  breadcrumbs?: PageBreadcrumb[];
  backHref?: string;
  mobileAction?: ActionSpec;
  mobileOverflow: ActionSpec[];
  headerActions: ActionSpec[];
  source: 'page' | 'title';
};

type Slot<T> = { owner: number; value: T } | null;

export type ShellContextValue = {
  /** Merged meta (Page meta, else shim title), or null when no page registered anything. */
  meta: ShellPageMeta | null;
  /** Low-level writers; prefer `usePageMetaSink` / `usePageTitle`. `owner` guards against stale clears. */
  setPageMeta: (owner: number, meta: PageShellMeta | null) => void;
  setFallbackTitle: (owner: number, title: string | null) => void;
};

/**
 * Two contexts (perf): writers are stable callbacks, so pages and the AppLayout shim that register meta
 * subscribe only to `ShellWriterContext` and do not re-render when the meta they wrote changes. Only the
 * shell's readers (TopBar, MobileTopBar, CommandPalette) subscribe to `ShellMetaContext`.
 */
type ShellWriters = Pick<ShellContextValue, 'setPageMeta' | 'setFallbackTitle'>;
const ShellWriterContext = React.createContext<ShellWriters | null>(null);
const ShellMetaContext = React.createContext<ShellPageMeta | null>(null);

let ownerSeq = 0;
function useOwnerId(): number {
  const ref = React.useRef(0);
  if (ref.current === 0) ref.current = ++ownerSeq;
  return ref.current;
}

export type ShellProviderProps = {
  children: React.ReactNode;
  /** Render `<title>` from the merged meta. Default true. */
  documentTitle?: boolean;
};

export function ShellProvider({ children, documentTitle = true }: ShellProviderProps) {
  const [pageMeta, setPageMetaSlot] = React.useState<Slot<PageShellMeta>>(null);
  const [fallback, setFallbackSlot] = React.useState<Slot<string>>(null);

  const setPageMeta = React.useCallback((owner: number, meta: PageShellMeta | null) => {
    setPageMetaSlot((prev) => {
      if (meta) return { owner, value: meta };
      return prev && prev.owner === owner ? null : prev;
    });
  }, []);

  const setFallbackTitle = React.useCallback((owner: number, title: string | null) => {
    setFallbackSlot((prev) => {
      if (title) return prev && prev.owner === owner && prev.value === title ? prev : { owner, value: title };
      return prev && prev.owner === owner ? null : prev;
    });
  }, []);

  const meta = React.useMemo<ShellPageMeta | null>(
    () => mergeShellMeta(pageMeta?.value ?? null, fallback?.value ?? null),
    [pageMeta, fallback],
  );

  const writers = React.useMemo<ShellWriters>(() => ({ setPageMeta, setFallbackTitle }), [setPageMeta, setFallbackTitle]);

  return (
    <ShellWriterContext.Provider value={writers}>
      <ShellMetaContext.Provider value={meta}>
        {documentTitle && meta?.title ? <ShellDocumentTitle title={meta.title} /> : null}
        {children}
      </ShellMetaContext.Provider>
    </ShellWriterContext.Provider>
  );
}

function ShellDocumentTitle({ title }: { title: string }) {
  const t = useTranslations('ds.page');
  return (
    <Head>
      <title>{t('documentTitle', { title })}</title>
    </Head>
  );
}

/** Pure merge: `<Page>` meta wins over the shim title. */
export function mergeShellMeta(page: PageShellMeta | null, fallbackTitle: string | null): ShellPageMeta | null {
  if (page) return { ...page, source: 'page' };
  if (fallbackTitle) return { title: fallbackTitle, mobileOverflow: [], headerActions: [], source: 'title' };
  return null;
}

/**
 * Raw context (null outside `ShellProvider`). Subscribes to both meta and writers; prefer `usePageMeta`
 * (readers) or `usePageMetaSink` / `usePageTitle` (writers).
 */
export function useShellContext(): ShellContextValue | null {
  const writers = React.useContext(ShellWriterContext);
  const meta = React.useContext(ShellMetaContext);
  return React.useMemo(() => (writers ? { meta, ...writers } : null), [writers, meta]);
}

/** Reader for TopBar / MobileTopBar / CommandPalette. Null outside the shell or before a page registers. */
export function usePageMeta(): ShellPageMeta | null {
  return React.useContext(ShellMetaContext);
}

/**
 * Writer for `<Page onShellMetaChange>`. Returns a stable callback (or `undefined` outside the shell, so
 * `<Page>` in tests and legacy layouts keeps working). The caller's meta is cleared when it unmounts.
 */
export function usePageMetaSink(): ((meta: PageShellMeta) => void) | undefined {
  const setPageMeta = React.useContext(ShellWriterContext)?.setPageMeta;
  const owner = useOwnerId();
  const sink = React.useCallback((meta: PageShellMeta) => setPageMeta?.(owner, meta), [setPageMeta, owner]);
  // Passive cleanup, on purpose: `<Page>` emits its meta from a passive effect, and React runs every passive
  // unmount cleanup of a commit before that commit's passive mount effects. On a route change the old
  // page's clear and the new page's set therefore batch into one render, so the TopBar never paints a
  // frame with meta = null. (A layout-effect clear would land before paint, a frame ahead of the set.)
  React.useEffect(() => {
    if (!setPageMeta) return undefined;
    return () => setPageMeta(owner, null);
  }, [setPageMeta, owner]);
  return setPageMeta ? sink : undefined;
}

/**
 * Title-only registration for pages that do not render `<Page>` yet (the `AppLayout` shim). Pass the bare
 * page name (no "· KolayXport" suffix; see `stripTitleSuffix`). Falsy titles register nothing.
 */
export function usePageTitle(title: string | null | undefined): void {
  const setFallbackTitle = React.useContext(ShellWriterContext)?.setFallbackTitle;
  const owner = useOwnerId();
  const clean = title ? stripTitleSuffix(title) : '';
  useIsomorphicLayoutEffect(() => {
    if (!setFallbackTitle) return undefined;
    setFallbackTitle(owner, clean || null);
    return () => setFallbackTitle(owner, null);
  }, [setFallbackTitle, owner, clean]);
}

const SUFFIX_RE = /\s*[-–—·|:]\s*KolayXport(\s+Dashboard)?\s*$/i;

/**
 * "Etsy Listings - KolayXport" → "Etsy Listings". Also handles "—", "·", "|", ":" and the legacy default
 * "KolayXport Dashboard" (→ ''), so the shell never doubles the suffix (shell-nav §6.1).
 */
export function stripTitleSuffix(title: string): string {
  const s = String(title ?? '').trim();
  if (/^KolayXport(\s+Dashboard)?$/i.test(s)) return '';
  return s.replace(SUFFIX_RE, '').trim();
}
