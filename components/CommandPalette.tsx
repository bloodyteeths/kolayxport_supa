import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Dialog, CircularProgress } from '@mui/material';
import { mutate as globalMutate } from 'swr';
import { toast } from 'react-hot-toast';
import { Search, X, CornerDownLeft, RefreshCw, PlusCircle, FileText, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import useScreenSize from '../hooks/useScreenSize';
import { isUsageLimitError, getErrorMessage } from '@/lib/notify';

/** A navigable destination (built by AppLayout from the connection-gated nav). */
export interface PaletteDestination {
  href: string;
  label: string;
  /** Section heading the destination lives under in the sidebar (searchable too). */
  section?: string | null;
  icon?: LucideIcon;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: PaletteDestination[];
  /** Show "New Etsy listing" (Etsy connected or still unknown). */
  canCreateEtsyListing?: boolean;
}

type PaletteEntry =
  | { kind: 'nav'; id: string; label: string; hint?: string | null; icon?: LucideIcon; href: string }
  | { kind: 'action'; id: string; label: string; hint?: string | null; icon: LucideIcon; run: () => void }
  | { kind: 'order'; id: string; label: string; hint?: string | null; href: string }
  | { kind: 'orderSearch'; id: string; label: string; href: string };

interface OrderHit {
  id: string;
  orderNumber: string;
  customerName: string;
  marketplace: string;
}

const ORDER_SEARCH_DEBOUNCE_MS = 250;
const ORDER_SEARCH_MIN_CHARS = 2;
const ORDER_SEARCH_LIMIT = 5;
const LABELS_PATH = '/app/labels';
/** Dispatched on window when the palette searches orders while /app/labels is open. detail: { q }. */
export const LABELS_SEARCH_EVENT = 'kx:labels-search';

/** Lowercase + strip diacritics so "siparis" matches "Siparişler". */
function fold(s: string, locale: string): string {
  let out: string;
  try {
    out = s.toLocaleLowerCase(locale);
  } catch {
    out = s.toLowerCase();
  }
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

/**
 * Subsequence fuzzy score: higher is better, -1 = no match. Rewards contiguous
 * runs and matches at word starts; a plain substring match always wins.
 */
function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  const idx = text.indexOf(query);
  if (idx >= 0) return 1000 - idx * 2 - (text.length - query.length) * 0.1;
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    if (ch === ' ') continue;
    const found = text.indexOf(ch, ti);
    if (found < 0) return -1;
    score += found === prevMatch + 1 ? 8 : 1;
    if (found === 0 || text[found - 1] === ' ' || text[found - 1] === '-') score += 5;
    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

function toOrderHits(raw: unknown): OrderHit[] {
  if (!raw || typeof raw !== 'object') return [];
  const orders = (raw as Record<string, unknown>).orders;
  if (!Array.isArray(orders)) return [];
  const out: OrderHit[] = [];
  for (const o of orders) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const orderNumber = typeof r.orderNumber === 'string' ? r.orderNumber : typeof r.orderNumber === 'number' ? String(r.orderNumber) : '';
    if (!orderNumber) continue;
    out.push({
      id: typeof r.id === 'string' ? r.id : orderNumber,
      orderNumber,
      customerName: typeof r.customerName === 'string' ? r.customerName : '',
      marketplace: typeof r.marketplace === 'string' ? r.marketplace : '',
    });
    if (out.length >= ORDER_SEARCH_LIMIT) break;
  }
  return out;
}

export default function CommandPalette({ open, onOpenChange, destinations, canCreateEtsyListing = false }: CommandPaletteProps) {
  const t = useTranslations('commandPalette');
  const tLabels = useTranslations('labels');
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale) || 'tr';
  const { isMobile } = useScreenSize();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [orderHits, setOrderHits] = useState<OrderHit[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Global Cmd/Ctrl+K toggles the palette.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onOpenChange(!openRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  // Fresh state each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setOrderHits([]);
    setOrdersLoading(false);
  }, [open]);

  // Debounced live order search (orders API `search`, all fields).
  const trimmed = query.trim();
  useEffect(() => {
    if (!open || trimmed.length < ORDER_SEARCH_MIN_CHARS) {
      setOrderHits([]);
      setOrdersLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setOrdersLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search: trimmed,
          searchType: 'all',
          page: '1',
          limit: String(ORDER_SEARCH_LIMIT),
        });
        const res = await fetch(`/api/orders?${params.toString()}`, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const hits = toOrderHits(await res.json());
        if (!controller.signal.aborted) setOrderHits(hits);
      } catch {
        if (!controller.signal.aborted) setOrderHits([]);
      } finally {
        if (!controller.signal.aborted) setOrdersLoading(false);
      }
    }, ORDER_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, trimmed]);

  const syncOrders = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const toastId = toast.loading(tLabels('syncingOrders'));
    try {
      const { fetchWithLimit } = await import('@/lib/fetchWithLimit');
      const res = await fetchWithLimit('/api/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncType: 'fast' }),
      });
      if (!res.ok) {
        let body: unknown = null;
        try { body = await res.json(); } catch { /* non-JSON error */ }
        throw { response: { status: res.status, data: body } };
      }
      toast.success(tLabels('ordersSyncSuccess'), { id: toastId });
      // Revalidate every orders list currently cached (labels page, dashboard).
      void globalMutate((key) => typeof key === 'string' && key.startsWith('/api/orders'));
      if (router.pathname !== LABELS_PATH) router.push(LABELS_PATH);
    } catch (e) {
      if (isUsageLimitError(e)) {
        toast.dismiss(toastId);
      } else {
        toast.error(`${tLabels('syncError')}: ${getErrorMessage(e)}`, { id: toastId });
      }
    } finally {
      syncingRef.current = false;
    }
  }, [router, tLabels]);

  const actions = useMemo(() => {
    const list: Array<Extract<PaletteEntry, { kind: 'action' }>> = [
      { kind: 'action', id: 'action:sync', label: t('syncOrders'), hint: t('syncOrdersHint'), icon: RefreshCw, run: () => { void syncOrders(); } },
    ];
    if (canCreateEtsyListing) {
      list.push({
        kind: 'action',
        id: 'action:new-etsy',
        label: t('newEtsyListing'),
        hint: t('newEtsyListingHint'),
        icon: PlusCircle,
        // The listings page has no "open creator" URL param yet; land on it.
        run: () => { router.push('/app/etsy-listings'); },
      });
    }
    return list;
  }, [t, syncOrders, canCreateEtsyListing, router]);

  const navEntries = useMemo<Array<Extract<PaletteEntry, { kind: 'nav' }>>>(() => {
    const seen = new Set<string>();
    const out: Array<Extract<PaletteEntry, { kind: 'nav' }>> = [];
    for (const d of destinations) {
      if (!d || typeof d.href !== 'string' || seen.has(d.href)) continue;
      seen.add(d.href);
      out.push({ kind: 'nav', id: `nav:${d.href}`, label: d.label, hint: d.section ?? null, icon: d.icon, href: d.href });
    }
    return out;
  }, [destinations]);

  const sections = useMemo(() => {
    const q = fold(trimmed, locale);
    const rank = <T extends { label: string; hint?: string | null }>(items: T[]): T[] => {
      if (!q) return items;
      return items
        .map((it) => {
          const s1 = fuzzyScore(fold(it.label, locale), q);
          const s2 = it.hint ? fuzzyScore(fold(`${it.hint} ${it.label}`, locale), q) - 50 : -1;
          return { it, score: Math.max(s1, s2) };
        })
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.it);
    };

    const out: Array<{ id: string; title: string; entries: PaletteEntry[] }> = [];
    const rankedActions = rank(actions);
    const rankedNav = rank(navEntries);

    if (trimmed.length >= ORDER_SEARCH_MIN_CHARS) {
      const orderEntries: PaletteEntry[] = orderHits.map((o) => ({
        kind: 'order',
        id: `order:${o.id}`,
        label: o.orderNumber,
        hint: [o.customerName, o.marketplace].filter(Boolean).join(' · ') || null,
        href: `${LABELS_PATH}?q=${encodeURIComponent(o.orderNumber)}`,
      }));
      orderEntries.push({
        kind: 'orderSearch',
        id: 'orderSearch',
        label: t('searchOrdersFor', { query: trimmed }),
        href: `${LABELS_PATH}?q=${encodeURIComponent(trimmed)}`,
      });
      // With a query, nav/actions matches come first (fast, exact intent);
      // orders below so typing a page name never jumps to an order.
      if (rankedActions.length) out.push({ id: 'actions', title: t('actions'), entries: rankedActions });
      if (rankedNav.length) out.push({ id: 'nav', title: t('goTo'), entries: rankedNav });
      out.push({ id: 'orders', title: t('orders'), entries: orderEntries });
    } else {
      if (rankedActions.length) out.push({ id: 'actions', title: t('actions'), entries: rankedActions });
      if (rankedNav.length) out.push({ id: 'nav', title: t('goTo'), entries: rankedNav });
    }
    return out;
  }, [trimmed, locale, actions, navEntries, orderHits, t]);

  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  // Keep the highlighted row valid as results change.
  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);
  useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(flat.length ? flat.length - 1 : 0);
  }, [flat.length, activeIndex]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const select = useCallback(
    (entry: PaletteEntry | undefined) => {
      if (!entry) return;
      close();
      if (entry.kind === 'action') {
        entry.run();
        return;
      }
      if ((entry.kind === 'order' || entry.kind === 'orderSearch') && router.pathname === LABELS_PATH) {
        // Same route: the labels page stays mounted and only reads its URL
        // filters once, so a router.push would change the URL but not the list.
        // Offer the query via a cancelable event; a listener on the labels page
        // calls preventDefault() once it has applied it. Without a listener,
        // fall back to a full navigation so the search always takes effect.
        const q = new URL(entry.href, window.location.origin).searchParams.get('q') ?? '';
        const evt = new CustomEvent(LABELS_SEARCH_EVENT, { detail: { q }, cancelable: true });
        const handled = !window.dispatchEvent(evt);
        if (!handled) window.location.assign(entry.href);
        return;
      }
      router.push(entry.href);
    },
    [close, router],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(flat[activeIndex]);
    }
    // Escape is handled by Dialog's onClose.
  };

  let runningIndex = -1;
  const listboxId = 'kx-command-palette-list';

  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen={isMobile}
      fullWidth
      maxWidth="sm"
      sx={{ zIndex: 1500 }}
      PaperProps={{
        sx: isMobile
          ? { m: 0, borderRadius: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
          : { borderRadius: 3, alignSelf: 'flex-start', mt: '12vh', maxHeight: '70vh', overflow: 'hidden' },
      }}
      TransitionProps={{ onEntered: () => inputRef.current?.focus() }}
      aria-label={t('title')}
    >
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-3 border-b border-slate-100 flex-shrink-0" style={{ minHeight: 56 }}>
          <Search size={18} className="text-slate-400 flex-shrink-0 ml-1" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('placeholder')}
            className="flex-1 min-w-0 bg-transparent outline-none text-base sm:text-sm text-slate-800 placeholder:text-slate-400"
            style={{ minHeight: 44 }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={flat[activeIndex] ? `kx-cp-${activeIndex}` : undefined}
            aria-label={t('placeholder')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {ordersLoading && <CircularProgress size={16} thickness={5} aria-label={t('searching')} />}
          {isMobile ? (
            <button
              type="button"
              onClick={close}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={t('close')}
            >
              <X size={18} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 border border-slate-200 rounded">Esc</kbd>
          )}
        </div>

        <div ref={listRef} id={listboxId} role="listbox" className="flex-1 overflow-y-auto py-2 min-h-0">
          {flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">{t('noResults')}</p>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="mb-1">
                <div className="px-4 pt-2 pb-1 text-[11px] font-semibold text-slate-400">
                  {section.title}
                </div>
                {section.entries.map((entry) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const active = idx === activeIndex;
                  const Icon: LucideIcon =
                    entry.kind === 'action' ? entry.icon
                      : entry.kind === 'nav' ? (entry.icon || ArrowRight)
                        : entry.kind === 'order' ? FileText
                          : Search;
                  const hint = 'hint' in entry ? entry.hint : null;
                  return (
                    <div
                      key={entry.id}
                      id={`kx-cp-${idx}`}
                      data-index={idx}
                      role="option"
                      aria-selected={active}
                      onMouseMove={() => { if (!active) setActiveIndex(idx); }}
                      onClick={() => select(entry)}
                      className={`mx-2 px-3 flex items-center gap-3 rounded-lg cursor-pointer select-none ${
                        active ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                      }`}
                      style={{ minHeight: 44 }}
                    >
                      <Icon size={17} className={active ? 'text-blue-600 flex-shrink-0' : 'text-slate-400 flex-shrink-0'} aria-hidden="true" />
                      <span className="flex-1 min-w-0 py-2">
                        <span className="block text-sm font-medium truncate">{entry.label}</span>
                        {hint && <span className="block text-[11px] text-slate-400 truncate">{hint}</span>}
                      </span>
                      {active && !isMobile && <CornerDownLeft size={14} className="text-blue-400 flex-shrink-0" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {!isMobile && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 flex-shrink-0">
            <span><kbd className="font-semibold">↑↓</kbd> {t('hintNavigate')}</span>
            <span><kbd className="font-semibold">↵</kbd> {t('hintSelect')}</span>
            <span><kbd className="font-semibold">Esc</kbd> {t('hintClose')}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
