// components/ds/shell/CommandPalette.tsx — ⌘K (shell-nav §3.6, §7; DS §4.2). Replaces components/CommandPalette.tsx.
//
// Mounted once by AppShell (group C):
//   <CommandPalette destinations={model.destinations} canCreateEtsyListing={model.known.etsy !== false} />
// Open state lives in `useShellStore` (`paletteOpen`) unless `open` / `onOpenChange` are passed. The palette
// installs ⌘K / Ctrl+K (toggle, works inside inputs) and `/` (opens it when the page registered no
// SearchField, which binds `/` in the higher `page` scope, and no dialog, drawer or menu is open).
//
// Groups with an empty query: On this page (PageHeader actions via ShellContext + usePageActions), Recent
// (last 5 run, localStorage `kx.palette.recent.v1`; only entries that still resolve to a live row, so a
// destination hidden by nav gating never comes back through Recent; page actions are not remembered), Actions (built-ins + useCommand), Go to (NavModel
// destinations). With a query: the same groups ranked (`lib/ds/fuzzy.ts`), Recent dropped, plus Orders
// (live search from 2 characters).
import * as React from 'react';
import { useRouter } from 'next/router';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { mutate as globalMutate } from 'swr';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { icons, ICON_STROKE, type LucideIcon } from '@/lib/ds/icons';
import { accent, backdrop, control, elevation, font, neutral as n, px, radius, space, type as typeScale, zIndex } from '@/lib/ds/tokens';
import { rankByQuery } from '@/lib/ds/fuzzy';
import {
  commandSignature,
  pushRecent,
  readRecent,
  useRegisteredCommands,
  type Command,
  type RecentEntry,
  type RegisteredCommand,
} from '@/lib/ds/useCommand';
import { actionsToCommands } from '@/lib/ds/usePageActions';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { usePageMeta } from '@/lib/nav/ShellContext';
import { useShellStore } from '@/lib/nav/useShellStore';
import { overlayBlocksShortcuts } from '@/lib/nav/useGoShortcuts';
import type { NavDestination } from '@/lib/nav/useNavModel';
import { NAV_COUNTS_KEY } from '@/lib/nav/useNavCounts';
import {
  ORDER_SEARCH_DEBOUNCE_MS,
  ORDER_SEARCH_MIN_CHARS,
  ORDERS_PATH,
  fetchOrderHits,
  needsFullNavigation,
  orderHitHref,
  type OrderHit,
} from '@/lib/nav/orderHits';
import { isUsageLimitError } from '@/lib/notify';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Kbd } from '@/components/ds/format/Kbd';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Button } from '@/components/ds/inputs/Button';
import { useToast } from '@/components/ds/feedback/toast';
import type { MarketplaceKey } from '@/components/ds/data/types';

// ── model ───────────────────────────────────────────────────────────────────

export type PaletteSectionId = 'page' | 'recent' | 'actions' | 'goto' | 'orders';

/** One selectable row. `run` is resolved by the palette (navigation or a command). */
export type PaletteEntry = {
  key: string;
  section: PaletteSectionId;
  label: string;
  /** Second line (action hint, disabled reason). */
  hint?: string;
  /** Right-hand caption (Go to: the nav group; orders: nothing, the logo says it). */
  meta?: string;
  icon?: LucideIcon;
  brand?: MarketplaceKey | string;
  /** `Kbd` keys ("g o", "mod+enter"). */
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  href?: string;
  run?: () => void | Promise<void>;
  /** What Recent stores when this row runs (null = not remembered, e.g. order hits). */
  recent: RecentEntry | null;
};

export type PaletteSection = { id: PaletteSectionId; entries: PaletteEntry[] };

export type BuildPaletteInput = {
  query: string;
  locale: string;
  /** Header actions (ShellContext) and usePageActions/useCommand registrations, already merged. */
  commands: readonly Command[];
  /** Built-in actions (Refresh orders, New Etsy listing). Hidden when a page command has the same label. */
  builtins: readonly Command[];
  destinations: readonly NavDestination[];
  recent: readonly RecentEntry[];
};

function foldLabel(s: string): string {
  return s.trim().toLocaleLowerCase('en');
}

/** Page-scoped commands (header actions, usePageActions) only exist on their page: never remembered. */
function isPageScoped(c: Command, section: PaletteSectionId): boolean {
  return section === 'page' || c.id.startsWith('page:');
}

export function commandToEntry(c: Command, section: PaletteSectionId): PaletteEntry {
  return {
    key: `cmd:${c.id}`,
    section,
    label: c.label,
    hint: c.disabled ? c.disabledReason ?? c.hint : c.hint,
    icon: c.icon,
    brand: c.brand,
    shortcut: c.shortcut,
    keywords: c.keywords,
    disabled: c.disabled,
    href: c.href,
    run: c.run,
    recent: isPageScoped(c, section) ? null : { id: `cmd:${c.id}`, label: c.label, ...(c.href ? { href: c.href } : {}) },
  };
}

export function destinationToEntry(d: NavDestination): PaletteEntry {
  return {
    key: `nav:${d.href}`,
    section: 'goto',
    label: d.label,
    meta: d.section,
    icon: d.icon,
    brand: d.brand,
    shortcut: d.gKey ? `g ${d.gKey}` : undefined,
    keywords: d.keywords,
    href: d.href,
    recent: { id: `nav:${d.href}`, label: d.label, href: d.href },
  };
}

/** Pure: the palette sections (Orders excluded; the component appends it). Empty sections are dropped. */
export function buildPaletteSections(input: BuildPaletteInput): PaletteSection[] {
  const { query, locale } = input;
  const hasQuery = query.trim().length > 0;

  const seenCmd = new Set<string>();
  const page: PaletteEntry[] = [];
  const actions: PaletteEntry[] = [];
  const goto: PaletteEntry[] = [];
  for (const c of input.commands) {
    if (seenCmd.has(c.id)) continue;
    seenCmd.add(c.id);
    if (c.onThisPage) page.push(commandToEntry(c, 'page'));
    else if (c.group === 'goto') goto.push(commandToEntry(c, 'goto'));
    else actions.push(commandToEntry(c, 'actions'));
  }
  const pageLabels = new Set(page.map((e) => foldLabel(e.label)));
  const builtinEntries = input.builtins
    .filter((b) => !seenCmd.has(b.id) && !pageLabels.has(foldLabel(b.label)))
    .map((b) => commandToEntry(b, 'actions'));
  actions.unshift(...builtinEntries);

  const seenHref = new Set(goto.map((e) => e.href).filter(Boolean) as string[]);
  for (const d of input.destinations) {
    if (!d || typeof d.href !== 'string' || seenHref.has(d.href)) continue;
    seenHref.add(d.href);
    goto.push(destinationToEntry(d));
  }

  if (hasQuery) {
    const out: PaletteSection[] = [];
    const rank = (list: PaletteEntry[]) => rankByQuery(list.map((e) => ({ ...e, hint: e.meta ?? e.hint })), query, locale)
      .map((e) => list.find((x) => x.key === e.key) as PaletteEntry);
    const p = rank(page);
    const a = rank(actions);
    const g = rank(goto);
    if (p.length) out.push({ id: 'page', entries: p });
    if (a.length) out.push({ id: 'actions', entries: a });
    if (g.length) out.push({ id: 'goto', entries: g });
    return out;
  }

  // Recent: only remembered ids that resolve to a live row. A stale entry (a destination that nav gating now
  // hides, a store that was disconnected, another account's row on a shared browser) is dropped, never
  // navigated by its stored href.
  const live = new Map<string, PaletteEntry>();
  for (const e of [...actions, ...goto]) if (e.recent) live.set(e.recent.id, e);
  const recent: PaletteEntry[] = [];
  const usedRecent = new Set<string>();
  for (const r of input.recent) {
    if (usedRecent.has(r.id)) continue;
    const hit = live.get(r.id);
    if (!hit) continue;
    recent.push({ ...hit, key: `recent:${hit.key}`, section: 'recent' });
    usedRecent.add(r.id);
  }
  const notRecent = (e: PaletteEntry) => !e.recent || !usedRecent.has(e.recent.id);

  const out: PaletteSection[] = [];
  if (page.length) out.push({ id: 'page', entries: page });
  if (recent.length) out.push({ id: 'recent', entries: recent });
  const a = actions.filter(notRecent);
  const g = goto.filter(notRecent);
  if (a.length) out.push({ id: 'actions', entries: a });
  if (g.length) out.push({ id: 'goto', entries: g });
  return out;
}

/** Pure: next enabled index from `from` in direction `dir` (wraps; -1 when nothing is enabled). */
export function nextEnabledIndex(entries: readonly Pick<PaletteEntry, 'disabled'>[], from: number, dir: 1 | -1): number {
  const len = entries.length;
  if (!len) return -1;
  for (let step = 1; step <= len; step++) {
    const i = (((from + dir * step) % len) + len) % len;
    if (!entries[i].disabled) return i;
  }
  return -1;
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

// ── order search ────────────────────────────────────────────────────────────

type OrderState = { status: 'idle' | 'loading' | 'done' | 'error'; hits: OrderHit[] };

function useOrderSearch(open: boolean, query: string): OrderState & { retry: () => void } {
  const [state, setState] = React.useState<OrderState>({ status: 'idle', hits: [] });
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  React.useEffect(() => {
    if (!open || query.length < ORDER_SEARCH_MIN_CHARS) {
      setState({ status: 'idle', hits: [] });
      return undefined;
    }
    const controller = new AbortController();
    setState((s) => ({ status: 'loading', hits: s.hits }));
    const timer = window.setTimeout(async () => {
      try {
        const hits = await fetchOrderHits(query, controller.signal);
        if (!controller.signal.aborted) setState({ status: 'done', hits });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', hits: [] });
      }
    }, ORDER_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, attempt]);
  return { ...state, retry };
}

// ── component ───────────────────────────────────────────────────────────────

export type CommandPaletteProps = {
  /** `NavModel.destinations` (group A): visible rows plus Etsy activity, Invoices, Guides. */
  destinations: readonly NavDestination[];
  /** Show "New Etsy listing" (Etsy connected or still unknown: `model.known.etsy !== false`). */
  canCreateEtsyListing?: boolean;
  /** Controlled open state. Default: `useShellStore().paletteOpen`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Install ⌘K and `/` (default true). */
  hotkeys?: boolean;
  className?: string;
  'data-testid'?: string;
};

const SECTION_LABEL_KEY: Record<PaletteSectionId, string> = {
  page: 'shell.palette.onThisPage',
  recent: 'shell.palette.recent',
  actions: 'commandPalette.actions',
  goto: 'commandPalette.goTo',
  orders: 'commandPalette.orders',
};

const [bodySize, bodyLine] = typeScale.body;
const [capSize, capLine] = typeScale.caption;
const [microSize, microLine, microWeight] = typeScale.micro;

export function CommandPalette({
  destinations,
  canCreateEtsyListing = false,
  open: openProp,
  onOpenChange,
  hotkeys = true,
  className,
  'data-testid': testId = 'command-palette',
}: CommandPaletteProps) {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const locale = useLocaleStore((s) => s.locale) || 'tr';
  const isMobile = useIsMobile();
  const storeOpen = useShellStore((s) => s.paletteOpen);
  const setStoreOpen = useShellStore((s) => s.setPaletteOpen);
  const open = openProp ?? storeOpen;
  const openRef = React.useRef(open);
  openRef.current = open;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setStoreOpen(next);
    },
    [onOpenChange, setStoreOpen],
  );
  const close = React.useCallback(() => setOpen(false), [setOpen]);

  const [query, setQuery] = React.useState('');
  // The highlighted row is tracked by key, so results arriving later (debounced order hits) never move it.
  // null = the first enabled row.
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<RecentEntry[]>([]);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const syncingRef = React.useRef(false);
  // Mirrors syncingRef for rendering: while a refresh runs, the built-in is listed disabled with the reason.
  const [syncing, setSyncing] = React.useState(false);
  const baseId = React.useId();
  const listboxId = `${baseId}-list`;

  // ⌘K / Ctrl+K toggles from anywhere, including inside inputs and over other overlays.
  React.useEffect(() => {
    if (!hotkeys) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLocaleLowerCase('en') === 'k') {
        e.preventDefault();
        setOpen(!openRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys, setOpen]);

  // `/` opens the palette unless a page SearchField claimed it (page scope outranks global).
  // Never on top of an open dialog, drawer or menu (no `modal` shortcut scope is registered by those yet).
  useShortcuts(
    {
      '/': {
        handler: (e) => {
          if (overlayBlocksShortcuts(e?.target ?? null)) return false;
          setOpen(true);
          return undefined;
        },
      },
    },
    { scope: 'global', enabled: hotkeys && !open },
  );

  // Fresh state on every open.
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveKey(null);
    setRecent(readRecent());
  }, [open]);

  const trimmed = query.trim();
  const orders = useOrderSearch(open, trimmed);

  const refreshOrders = React.useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    // A timed toast (the DS has no persistent info toast); the palette row stays disabled with the same
    // text until the request settles, so a second attempt explains itself.
    const pendingId = toast.info(t('shell.palette.refreshing'));
    try {
      const { fetchWithLimit } = await import('@/lib/fetchWithLimit');
      const res = await fetchWithLimit('/api/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncType: 'fast' }),
      });
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* non-JSON error */
        }
        throw { response: { status: res.status, data: body } };
      }
      toast.dismiss(pendingId);
      toast.success(t('shell.palette.refreshed'));
      void globalMutate((key) => typeof key === 'string' && (key.startsWith('/api/orders') || key === NAV_COUNTS_KEY));
      if (router.pathname !== ORDERS_PATH) void router.push(ORDERS_PATH);
    } catch (e) {
      toast.dismiss(pendingId);
      // The usage-limit interceptor already shows its own dialog.
      if (!isUsageLimitError(e)) toast.error(t('labels.syncError'));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [router, t, toast]);

  const builtins = React.useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'orders.refresh',
        label: t('commandPalette.syncOrders'),
        hint: t('commandPalette.syncOrdersHint'),
        group: 'actions',
        icon: icons.pull,
        disabled: syncing,
        disabledReason: syncing ? t('shell.palette.refreshing') : undefined,
        run: () => {
          void refreshOrders();
        },
      },
    ];
    if (canCreateEtsyListing) {
      list.push({
        id: 'etsy.newListing',
        label: t('commandPalette.newEtsyListing'),
        hint: t('commandPalette.newEtsyListingHint'),
        group: 'actions',
        icon: icons.add,
        brand: 'etsy',
        // The listings page has no "open creator" URL param yet; land on it.
        href: '/app/etsy-listings',
      });
    }
    return list;
  }, [t, refreshOrders, canCreateEtsyListing, syncing]);

  const meta = usePageMeta();
  const registered = useRegisteredCommands();
  // Every displayed field (the registry's own signature), so a changed reason, icon or shortcut re-renders.
  const headerKey = actionsToCommands(meta?.headerActions ?? []).map(commandSignature).join('\n');
  const headerActionsRef = React.useRef(meta?.headerActions ?? []);
  headerActionsRef.current = meta?.headerActions ?? [];
  const commands = React.useMemo<Command[]>(() => {
    // Header actions resolve their handler at run time, so a re-render of the page never leaves a stale one.
    const header = actionsToCommands(headerActionsRef.current).map((c) => ({
      ...c,
      run: c.run ? () => headerActionsRef.current.find((a) => `page:${a.id}` === c.id)?.onClick?.() : undefined,
    }));
    const pageRegistered = registered.filter((c: RegisteredCommand) => c.source === 'page');
    const appRegistered = registered.filter((c: RegisteredCommand) => c.source === 'app');
    return [...header, ...pageRegistered, ...appRegistered];
    // `headerKey` stands in for the header actions' displayed fields.
  }, [headerKey, registered]);

  const sections = React.useMemo<PaletteSection[]>(() => {
    const base = buildPaletteSections({ query, locale, commands, builtins, destinations, recent });
    if (trimmed.length < ORDER_SEARCH_MIN_CHARS) return base;
    const orderEntries: PaletteEntry[] = orders.hits.map((o) => ({
      key: `order:${o.id}`,
      section: 'orders',
      label: [o.orderNumber, o.customerName].filter(Boolean).join(' · '),
      icon: icons.order,
      brand: o.marketplace || undefined,
      href: orderHitHref(o.orderNumber),
      recent: null,
    }));
    orderEntries.push({
      key: 'order:search',
      section: 'orders',
      label: t('commandPalette.searchOrdersFor', { query: trimmed }),
      icon: icons.search,
      href: orderHitHref(trimmed),
      recent: null,
    });
    // Page and command matches come first, so typing a page name never jumps to an order.
    return [...base, { id: 'orders', entries: orderEntries }];
  }, [query, locale, commands, builtins, destinations, recent, trimmed, orders.hits, t]);

  const flat = React.useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  const activeIndex = React.useMemo(() => {
    if (activeKey !== null) {
      const i = flat.findIndex((e) => e.key === activeKey);
      if (i >= 0 && !flat[i].disabled) return i;
    }
    return flat.length ? Math.max(0, nextEnabledIndex(flat, -1, 1)) : 0;
  }, [flat, activeKey]);
  const setActiveIndex = React.useCallback((i: number) => setActiveKey(flat[i]?.key ?? null), [flat]);

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const navigate = React.useCallback(
    (href: string, section: PaletteSectionId) => {
      if (isExternal(href)) {
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      // Until M3 the Orders page reads `q` only on mount: on that route, do a full navigation.
      if (section === 'orders' && needsFullNavigation(router.pathname)) {
        window.location.assign(href);
        return;
      }
      void router.push(href);
    },
    [router],
  );

  const select = React.useCallback(
    (entry: PaletteEntry | undefined) => {
      if (!entry || entry.disabled) return;
      close();
      if (entry.recent) setRecent(pushRecent(entry.recent));
      if (entry.run) {
        void entry.run();
        return;
      }
      if (entry.href) navigate(entry.href, entry.section);
    },
    [close, navigate],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = nextEnabledIndex(flat, activeIndex, 1);
      if (i >= 0) setActiveIndex(i);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = nextEnabledIndex(flat, activeIndex, -1);
      if (i >= 0) setActiveIndex(i);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      select(flat[activeIndex]);
    }
    // Escape: Dialog onClose.
  };

  let runningIndex = -1;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const showSpinner = orders.status === 'loading' && trimmed.length >= ORDER_SEARCH_MIN_CHARS;

  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen={isMobile}
      maxWidth={false}
      className={className}
      data-testid={testId}
      sx={{ zIndex: zIndex.palette }}
      slotProps={{ backdrop: { sx: { bgcolor: backdrop } } }}
      PaperProps={{
        // MUI puts `aria-label` on the Modal root; the role="dialog" Paper needs the name itself.
        'aria-label': t('commandPalette.title'),
        sx: isMobile
          ? {
              m: 0,
              borderRadius: 0,
              boxShadow: 'none',
              pt: 'env(safe-area-inset-top, 0px)',
              pb: 'env(safe-area-inset-bottom, 0px)',
            }
          : {
              width: 640,
              maxWidth: 'calc(100vw - 32px)',
              m: 0,
              mt: '12vh',
              alignSelf: 'flex-start',
              maxHeight: '70vh',
              overflow: 'hidden',
              borderRadius: px(radius.lg),
              boxShadow: elevation.e4,
              border: `1px solid ${n[200]}`,
            },
      }}
      TransitionProps={{ onEntered: () => inputRef.current?.focus() }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: font.sans }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: px(space[2]),
            px: px(space[4]),
            minHeight: control.xl,
            borderBottom: `1px solid ${n[100]}`,
            flexShrink: 0,
          }}
        >
          <icons.search size={18} strokeWidth={ICON_STROKE} color={n[400]} aria-hidden="true" style={{ flexShrink: 0 }} />
          <Box
            component="input"
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
              // A new query starts again from the first enabled row.
              setActiveKey(null);
            }}
            onKeyDown={onInputKeyDown}
            placeholder={t('commandPalette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={flat[activeIndex] ? optionId(activeIndex) : undefined}
            aria-label={t('commandPalette.placeholder')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: control.xl,
              border: 0,
              outline: 'none',
              bgcolor: 'transparent',
              color: n[800],
              fontFamily: font.sans,
              // 16px on every viewport: iOS zooms into smaller inputs.
              fontSize: 16,
              lineHeight: '24px',
              '&::placeholder': { color: n[400], opacity: 1 },
            }}
          />
          {showSpinner ? <CircularProgress size={16} thickness={5} aria-hidden="true" /> : null}
          {isMobile ? (
            <Button variant="ghost" size="sm" onClick={close}>
              {t('shell.palette.cancel')}
            </Button>
          ) : (
            <Kbd keys="esc" />
          )}
        </Box>

        <Box
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('commandPalette.title')}
          sx={{ flex: 1, overflowY: 'auto', py: px(space[2]), minHeight: 0 }}
        >
          {flat.length === 0 ? (
            <Box component="p" sx={{ m: 0, px: px(space[4]), py: px(space[8]), textAlign: 'center', color: n[500], fontSize: bodySize, lineHeight: px(bodyLine) }}>
              {t('commandPalette.noResults')}
            </Box>
          ) : (
            sections.map((section) => (
              <Box key={section.id} role="group" aria-labelledby={`${baseId}-sec-${section.id}`} sx={{ mb: px(space[1]) }}>
                <Box
                  id={`${baseId}-sec-${section.id}`}
                  sx={{ px: px(space[4]), pt: px(space[2]), pb: px(space[1]), color: n[500], fontSize: microSize, lineHeight: px(microLine), fontWeight: microWeight }}
                >
                  {t(SECTION_LABEL_KEY[section.id])}
                </Box>
                {section.entries.map((entry) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  return (
                    <PaletteRow
                      key={entry.key}
                      id={optionId(idx)}
                      index={idx}
                      entry={entry}
                      active={idx === activeIndex}
                      showEnter={!isMobile}
                      onHover={() => {
                        if (idx !== activeIndex && !entry.disabled) setActiveIndex(idx);
                      }}
                      onSelect={() => select(entry)}
                    />
                  );
                })}
                {section.id === 'orders' ? (
                  <OrderStatusLine
                    status={orders.status}
                    count={orders.hits.length}
                    query={trimmed}
                    onRetry={() => {
                      orders.retry();
                      inputRef.current?.focus();
                    }}
                  />
                ) : null}
              </Box>
            ))
          )}
        </Box>

        {!isMobile ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: px(space[4]),
              px: px(space[4]),
              py: px(space[2]),
              borderTop: `1px solid ${n[100]}`,
              color: n[500],
              fontSize: capSize,
              lineHeight: px(capLine),
              flexShrink: 0,
            }}
          >
            <FooterHint keys="up down" label={t('commandPalette.hintNavigate')} />
            <FooterHint keys="enter" label={t('commandPalette.hintSelect')} />
            <FooterHint keys="esc" label={t('commandPalette.hintClose')} />
          </Box>
        ) : null}
      </Box>
    </Dialog>
  );
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]) }}>
      <Kbd keys={keys} />
      <span>{label}</span>
    </Box>
  );
}

/** The Orders group's state row (shell-nav §5): Searching…, no matches, or the error with Retry. */
function OrderStatusLine({ status, count, query, onRetry }: { status: OrderState['status']; count: number; query: string; onRetry: () => void }) {
  const t = useTranslations();
  let text: string | null = null;
  if (status === 'loading') text = t('commandPalette.searching');
  else if (status === 'error') text = t('shell.palette.searchError');
  else if (status === 'done' && count === 0) text = t('shell.palette.noOrders', { query });
  if (!text) return null;
  return (
    <Box
      role="status"
      data-testid="palette-order-status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: px(space[2]),
        px: px(space[4] + space[2]),
        py: px(space[1]),
        color: status === 'error' ? n[600] : n[500],
        fontSize: capSize,
        lineHeight: px(capLine),
      }}
    >
      <span>{text}</span>
      {status === 'error' ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t('shell.palette.retry')}
        </Button>
      ) : null}
    </Box>
  );
}

type PaletteRowProps = {
  id: string;
  index: number;
  entry: PaletteEntry;
  active: boolean;
  showEnter: boolean;
  onHover: () => void;
  onSelect: () => void;
};

function PaletteRow({ id, index, entry, active, showEnter, onHover, onSelect }: PaletteRowProps) {
  const Icon = entry.icon ?? icons.next;
  const iconColor = active ? accent[600] : n[400];
  return (
    <Box
      id={id}
      data-index={index}
      data-key={entry.key}
      role="option"
      aria-selected={active}
      aria-disabled={entry.disabled || undefined}
      onMouseMove={onHover}
      onClick={entry.disabled ? undefined : onSelect}
      sx={{
        mx: px(space[2]),
        px: px(space[3]),
        minHeight: control.lg,
        display: 'flex',
        alignItems: 'center',
        gap: px(space[3]),
        borderRadius: px(radius.md),
        cursor: entry.disabled ? 'default' : 'pointer',
        userSelect: 'none',
        bgcolor: active ? accent[50] : 'transparent',
        color: entry.disabled ? n[400] : active ? accent[700] : n[700],
      }}
    >
      {entry.brand && entry.section !== 'orders' && !entry.icon ? (
        <LogoTile brand={entry.brand} size={16} />
      ) : (
        <Icon size={16} strokeWidth={ICON_STROKE} color={iconColor} aria-hidden="true" style={{ flexShrink: 0 }} />
      )}
      <Box component="span" sx={{ flex: 1, minWidth: 0, py: px(space[2]) }}>
        <Box component="span" sx={{ display: 'block', fontSize: bodySize, lineHeight: px(bodyLine), fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.label}
        </Box>
        {entry.hint ? (
          <Box component="span" sx={{ display: 'block', fontSize: capSize, lineHeight: px(capLine), color: n[500], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.hint}
          </Box>
        ) : null}
      </Box>
      {entry.section === 'orders' && entry.brand ? <LogoTile brand={entry.brand} size={16} withName /> : null}
      {entry.brand && entry.icon && entry.section !== 'orders' ? <LogoTile brand={entry.brand} size={16} /> : null}
      {entry.meta ? (
        <Box component="span" sx={{ flexShrink: 0, fontSize: capSize, lineHeight: px(capLine), color: n[500] }}>
          {entry.meta}
        </Box>
      ) : null}
      {entry.shortcut ? <Kbd keys={entry.shortcut} /> : null}
      {active && showEnter && !entry.shortcut ? <Kbd keys="enter" /> : null}
    </Box>
  );
}

// ── "g …" hint ──────────────────────────────────────────────────────────────

export type GoShortcutHintProps = { visible: boolean; className?: string; 'data-testid'?: string };

/**
 * The small bottom-left hint shown for the second after `g` (shell-nav §7). AppShell renders
 * `<GoShortcutHint visible={useGoShortcuts(model.goShortcuts).pending} />`.
 */
export function GoShortcutHint({ visible, className, 'data-testid': testId = 'go-shortcut-hint' }: GoShortcutHintProps) {
  const t = useTranslations('shell.shortcuts');
  if (!visible) return null;
  return (
    <Box
      role="status"
      aria-label={t('goHint')}
      className={className}
      data-testid={testId}
      sx={{
        position: 'fixed',
        left: px(space[4]),
        bottom: `calc(${px(space[4])} + var(--kx-bottom-nav, 0px))`,
        zIndex: zIndex.popover,
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(space[1]),
        px: px(space[2]),
        py: px(space[1]),
        borderRadius: px(radius.sm),
        bgcolor: n[0],
        border: `1px solid ${n[200]}`,
        boxShadow: elevation.e2,
        color: n[600],
        fontSize: capSize,
        lineHeight: px(capLine),
        pointerEvents: 'none',
      }}
    >
      <Kbd keys="g" />
      <span aria-hidden="true">{'…'}</span>
    </Box>
  );
}

export default CommandPalette;
