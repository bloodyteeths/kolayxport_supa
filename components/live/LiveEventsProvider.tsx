/**
 * LiveEventsProvider (owner W6-live) — mount ONCE for the whole app, above the
 * page component, so client-side navigation never remounts it (see
 * LiveAppMount, mounted from pages/_app.tsx). Renders nothing but its children.
 *
 * - One EventSource to /api/live/stream per BROWSER and ACCOUNT, not per tab:
 *   tabs elect a leader with the Web Locks API (lock `kx-live-leader:<userKey>`);
 *   the leader holds the stream and relays envelopes to the other tabs over
 *   BroadcastChannel(`kx-live:<userKey>`). Both names are scoped by the signed-in
 *   user, and the stream's hello carries the server-side user key: a stream that
 *   belongs to another account is dropped, never consumed or relayed. (Production
 *   nginx speaks HTTP/1.1, where a browser allows only 6 connections per
 *   origin — one SSE per tab would starve normal requests after a few tabs.)
 *   Without Web Locks/BroadcastChannel every tab opens its own stream.
 * - Reconnect: native EventSource retry (server `retry:`), plus manual
 *   exponential backoff (1 s .. 60 s) when the stream is closed for good, an
 *   idle watchdog (no data for 75 s => reopen) and immediate reopen on
 *   `online` / tab becoming visible.
 * - Every event: deduped by id, dispatched as window CustomEvent('kx:live'),
 *   and SWR keys for its type are revalidated (orders, notifications, stock,
 *   connections) so SWR pages refresh without any page code.
 * - order.new: chime (unless muted; once per browser — any tab whose audio is
 *   unlocked may play it: the focused/visible tab first, hidden armed tabs after
 *   a staggered delay unless another tab already claimed it), toast with order
 *   number / amount / marketplace
 *   and an Open action (/app/labels?highlight=<id>), "(N) " title prefix until
 *   the tab is focused. Bursts within 700 ms collapse into one toast + chime.
 * - order.cancelled: softer sound + warning toast.
 * - Stream down > 60 s: every 60 s a synthetic `sync.status` (phase 'polling')
 *   is dispatched and orders/notifications are revalidated.
 * - lastEventId, the seen-id ring and the unseen counter live in liveStore
 *   (module scope), so a remount resumes with ?lastEventId= (server replays the
 *   gap) and an unmount flushes a pending new-order batch instead of dropping it.
 */
import React, { useEffect, useRef } from 'react';
import Router from 'next/router';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { LiveEnvelope, LiveEvent, LiveOrderSummary } from '@/lib/live/types';
import { LIVE_SWR_PREFIXES } from '@/lib/live/names';
import { liveUserKey } from '@/lib/live/names';
import {
  dispatchLiveWindowEvent,
  getLiveResumeState,
  markLiveSeen,
  markRecentOrder,
  setLiveStatus,
  syntheticEnvelope,
  toClientEvent,
} from './liveStore';
import { armOrderSound, isOrderSoundMuted, isSoundArmed, playOrderSound } from './orderSound';
import { revalidateSwrPrefix } from './useLiveEvent';

export type LiveEventsProviderProps = {
  /** false (e.g. no session) => no stream. Default true. */
  enabled?: boolean;
  /**
   * Signed-in user's id (session.user.id). Scopes the cross-tab channel/lock and
   * is checked against the stream's hello, so one account's events never reach
   * another account's tabs. Strongly recommended; without it the names are shared.
   */
  userId?: string | null;
  /** Orders page the toast's Open action navigates to. */
  ordersPath?: string;
  children?: React.ReactNode;
};

const STREAM_URL = '/api/live/stream';
const CHANNEL_PREFIX = 'kx-live:';
const LOCK_PREFIX = 'kx-live-leader:';
const IDLE_REOPEN_MS = 75_000;
const POLL_AFTER_MS = 60_000;
const POLL_EVERY_MS = 60_000;
const BATCH_MS = 700;
/** Do not chime for old orders (first import / backfill leaking through). */
const MAX_ORDER_AGE_MS = 72 * 3600_000;
/** Throttle window per SWR prefix (leading + trailing). */
const SWR_THROTTLE_MS = 1000;
/** A focused tab chimes at once; a visible unfocused one shortly after; hidden armed tabs after BASE + jitter. */
const VISIBLE_UNFOCUSED_CHIME_MS = 80;
const HIDDEN_CHIME_BASE_MS = 350;
const HIDDEN_CHIME_JITTER_MS = 450;

type BusMessage =
  | { kind: 'env'; env: LiveEnvelope }
  | { kind: 'claim'; ids: string[] }
  | { kind: 'status'; status: 'connecting' | 'live' | 'offline' | 'polling' }
  /** a tab that just started asks the stream holder for its status */
  | { kind: 'who' };

const MARKETPLACE_LABELS: Record<string, string> = {
  etsy: 'Etsy',
  ebay: 'eBay',
  trendyol: 'Trendyol',
  shopify: 'Shopify',
  wix: 'Wix',
  amazon: 'Amazon',
  hepsiburada: 'Hepsiburada',
  veeqo: 'Veeqo',
  shippo: 'Shippo',
};

export function marketplaceLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  const k = raw.trim().toLowerCase();
  for (const [key, label] of Object.entries(MARKETPLACE_LABELS)) if (k === key || k.startsWith(`${key}-`) || k.startsWith(`${key} `)) return label;
  return raw.trim().slice(0, 40);
}

export function formatOrderAmount(total: number | null, currency: string | null, locale: string): string {
  if (total === null || total === undefined || !Number.isFinite(total)) return '';
  try {
    if (currency && /^[A-Za-z]{3}$/.test(currency)) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(total);
    }
  } catch {
    /* unknown currency */
  }
  return `${total.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}

function orderAgeMs(o: LiveOrderSummary, now: number): number {
  const d = o.uiOrderDate || o.createdAt;
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? now - t : 0;
}

function isVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function hasFocus(): boolean {
  try {
    return typeof document !== 'undefined' && document.hasFocus();
  } catch {
    return false;
  }
}

const TITLE_PREFIX_RE = /^\(\d+\)\s+/;

type ToastCopy = {
  title: string;
  body: string;
  open: string;
  close: string;
  thumbnail?: string | null;
  tone: 'new' | 'cancelled';
};

function LiveToast({ id, copy, href, visible }: { id: string; copy: ToastCopy; href: string; visible: boolean }) {
  const Icon = copy.tone === 'cancelled' ? CancelRoundedIcon : ShoppingBagRoundedIcon;
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        width: { xs: 'calc(100vw - 32px)', sm: 380 },
        maxWidth: 420,
        p: 1.25,
        pr: 0.75,
        borderRadius: 2,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: '0 8px 28px rgba(15, 23, 42, 0.18)',
        border: '1px solid',
        borderColor: copy.tone === 'cancelled' ? 'warning.light' : 'success.light',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-8px)',
        transition: 'opacity 160ms ease, transform 160ms ease',
      }}
    >
      {copy.thumbnail ? (
        <Box
          component="img"
          src={copy.thumbnail}
          alt=""
          sx={{ width: 44, height: 44, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0, bgcolor: 'action.hover' }}
        />
      ) : (
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 1.5,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: (theme) => alpha(copy.tone === 'cancelled' ? theme.palette.warning.main : theme.palette.success.main, 0.12),
            color: copy.tone === 'cancelled' ? 'warning.main' : 'success.main',
          }}
        >
          <Icon />
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
          {copy.title}
        </Typography>
        {copy.body ? (
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }} noWrap>
            {copy.body}
          </Typography>
        ) : null}
      </Box>
      <Button
        size="small"
        variant="contained"
        disableElevation
        onClick={() => {
          toast.dismiss(id);
          void Router.push(href);
        }}
        sx={{ minHeight: 36, flexShrink: 0 }}
      >
        {copy.open}
      </Button>
      <IconButton size="small" aria-label={copy.close} onClick={() => toast.dismiss(id)} sx={{ flexShrink: 0 }}>
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

/**
 * react-hot-toast supports a render function (gives `visible` for the exit
 * fade); the repo's local typings in types/react-hot-toast.d.ts only declare
 * ReactNode, hence the narrow cast.
 */
const customToast = toast.custom as unknown as (
  render: (tt: { id: string; visible: boolean }) => React.ReactElement,
  opts?: { id?: string; duration?: number },
) => string;

function showLiveToast(toastId: string, copy: ToastCopy, href: string, durationMs: number) {
  customToast((tt) => <LiveToast id={tt.id} copy={copy} href={href} visible={tt.visible} />, {
    id: toastId,
    duration: durationMs,
  });
}

export default function LiveEventsProvider({
  enabled = true,
  userId = null,
  ordersPath = '/app/labels',
  children,
}: LiveEventsProviderProps) {
  const t = useTranslations('liveOrders');
  const locale = useLocale();
  // Latest i18n/route values for the long-lived effect below (no re-subscribe on locale change).
  const tRef = useRef(t);
  tRef.current = t;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const ordersPathRef = useRef(ordersPath);
  ordersPathRef.current = ordersPath;
  const expectedUserKey = userId ? liveUserKey(userId) : null;
  const scopeKey = expectedUserKey || 'anon';

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    armOrderSound();

    let disposed = false;
    // Survives remounts (same user): resume id, dedupe ring, unseen counter.
    const resume = getLiveResumeState(scopeKey);
    const claimed = new Set<string>();
    const swrTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const swrPending = new Set<string>();
    let isLeader = false;
    let leaderStatus: 'connecting' | 'live' | 'offline' | 'polling' = 'connecting';

    // ---- cross-tab relay -------------------------------------------------
    const channel: BroadcastChannel | null =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`${CHANNEL_PREFIX}${scopeKey}`) : null;
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    const post = (msg: BusMessage) => {
      try {
        channel?.postMessage(msg);
      } catch {
        /* ignore */
      }
    };

    // ---- title badge -------------------------------------------------------
    const applyTitle = () => {
      const base = document.title.replace(TITLE_PREFIX_RE, '');
      const want = resume.unseenOrders > 0 ? `(${resume.unseenOrders}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    const titleObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => resume.unseenOrders > 0 && applyTitle()) : null;
    if (titleObserver) titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
    const clearUnseen = () => {
      if (resume.unseenOrders === 0) return;
      if (!isVisible() || !hasFocus()) return;
      resume.unseenOrders = 0;
      applyTitle();
    };
    if (resume.unseenOrders > 0) {
      applyTitle();
      clearUnseen();
    }

    // ---- SWR revalidation (throttled per prefix, leading + trailing) -------
    // Leading run on the first event; any event inside the window marks the
    // prefix pending and gets ONE trailing run when the window ends, so an
    // order committed right after the first refetch started is still fetched.
    const revalidate = (prefix: string) => {
      if (swrTimers.has(prefix)) {
        swrPending.add(prefix);
        return;
      }
      revalidateSwrPrefix(prefix);
      const arm = () => {
        swrTimers.set(
          prefix,
          setTimeout(() => {
            if (swrPending.has(prefix)) {
              swrPending.delete(prefix);
              revalidateSwrPrefix(prefix);
              arm();
            } else {
              swrTimers.delete(prefix);
            }
          }, SWR_THROTTLE_MS),
        );
      };
      arm();
    };
    const revalidateFor = (ev: LiveEvent) => {
      if (ev.type === 'invalidate') {
        for (const k of ev.keys || []) if (typeof k === 'string' && k.startsWith('/')) revalidate(k);
        return;
      }
      if (ev.type === 'sync') {
        if (ev.kind === 'finished' && (ev.newOrders || ev.updatedOrders)) revalidate('/api/orders');
        if (ev.kind === 'status' && (ev.phase === 'reconnected' || ev.phase === 'polling')) {
          revalidate('/api/orders');
          revalidate('/api/notifications');
        }
        return;
      }
      for (const p of LIVE_SWR_PREFIXES[ev.type] || []) revalidate(p);
    };

    // ---- new-order batching, toast, chime ----------------------------------
    let batch: { envId: string; order: LiveOrderSummary }[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    // Audio unlock is per document, so the player is chosen by "can this tab
    // play right now" (armed), never by stream leadership. Every armed tab
    // bids: focused tab immediately, visible-unfocused shortly after, hidden
    // ones after a staggered delay; the first to play posts a claim and the
    // others stand down. An unarmed tab never blocks an armed one.
    const chime = (kind: 'new' | 'cancelled', ids: string[]) => {
      if (isOrderSoundMuted() || ids.length === 0) return;
      const attemptPlay = () => {
        if (ids.some((id) => claimed.has(id))) return;
        if (isOrderSoundMuted() || !isSoundArmed()) return;
        if (playOrderSound(kind)) {
          for (const id of ids) claimed.add(id);
          post({ kind: 'claim', ids });
        }
      };
      if (!isSoundArmed()) return; // this document cannot play; an armed tab will
      let delay = 0;
      if (channel) {
        if (!isVisible()) delay = HIDDEN_CHIME_BASE_MS + Math.floor(Math.random() * HIDDEN_CHIME_JITTER_MS);
        else if (!hasFocus()) delay = VISIBLE_UNFOCUSED_CHIME_MS + Math.floor(Math.random() * 60);
      }
      if (delay === 0) attemptPlay();
      else setTimeout(attemptPlay, delay);
    };

    const flushBatch = () => {
      batchTimer = null;
      const items = batch;
      batch = [];
      if (items.length === 0 || disposed) return;
      const tr = tRef.current;
      const ids = items.map((i) => i.envId);
      if (!isVisible() || !hasFocus()) {
        resume.unseenOrders += items.length;
        applyTitle();
      }
      chime('new', ids);
      if (!isVisible()) return;
      const base = ordersPathRef.current;
      if (items.length === 1) {
        const o = items[0].order;
        const mp = marketplaceLabel(o.marketplace);
        const amount = formatOrderAmount(o.totalPrice, o.currency, localeRef.current);
        const num = o.orderNumber || o.marketplaceKey || '';
        const bodyParts = [
          num ? `#${num}` : '',
          amount,
          o.itemCount ? tr('toast.items', { count: o.itemCount }) : '',
          o.customerName || '',
        ].filter(Boolean);
        showLiveToast(
          `live-order-${o.id}`,
          {
            title: mp ? tr('toast.newOrderFrom', { marketplace: mp }) : tr('toast.newOrder'),
            body: bodyParts.join(' · '),
            open: tr('toast.open'),
            close: tr('toast.close'),
            thumbnail: o.thumbnail,
            tone: 'new',
          },
          `${base}?highlight=${encodeURIComponent(o.id)}`,
          10_000,
        );
      } else {
        const marketplaces = Array.from(new Set(items.map((i) => marketplaceLabel(i.order.marketplace)).filter(Boolean)));
        showLiveToast(
          `live-orders-${ids[0]}`,
          {
            title: tr('toast.newOrders', { count: items.length }),
            body: marketplaces.join(', '),
            open: tr('toast.open'),
            close: tr('toast.close'),
            tone: 'new',
          },
          base,
          10_000,
        );
      }
    };

    const onCancelled = (envId: string, o: LiveOrderSummary) => {
      chime('cancelled', [envId]);
      if (!isVisible()) return;
      const tr = tRef.current;
      const mp = marketplaceLabel(o.marketplace);
      const num = o.orderNumber || o.marketplaceKey || '';
      showLiveToast(
        `live-cancel-${o.id}`,
        {
          title: tr('toast.cancelled', { orderNumber: num ? `#${num}` : '' }).trim(),
          body: [mp, o.customerName || ''].filter(Boolean).join(' · ') || tr('toast.cancelledHint'),
          open: tr('toast.open'),
          close: tr('toast.close'),
          tone: 'cancelled',
        },
        `${ordersPathRef.current}?highlight=${encodeURIComponent(o.id)}`,
        12_000,
      );
    };

    // ---- per-tab handling of one envelope ----------------------------------
    // resume.lastEventId: last server event id seen by THIS tab (relayed ones
    // too), kept across remounts, so a follower that takes over the stream (or
    // a remounted provider) resumes with ?lastEventId= and gets the gap replayed.
    const handle = (env: LiveEnvelope) => {
      if (disposed || !env || typeof env.id !== 'string' || !env.event) return;
      if (!markLiveSeen(resume, env.id)) return;
      if (!env.id.startsWith('local-')) resume.lastEventId = env.id;

      const ev = env.event;
      if (ev.type === 'sync' && ev.kind === 'status' && ev.phase === 'heartbeat') return;
      dispatchLiveWindowEvent(toClientEvent(env));
      revalidateFor(ev);

      if (ev.type === 'order') {
        // Event age needs no check: the server only replays the last 5 min.
        // Order age is checked (72 h) so a backfill leaking through never chimes.
        const now = Date.now();
        if (ev.kind === 'new') {
          markRecentOrder(ev.order.id);
          if (orderAgeMs(ev.order, now) <= MAX_ORDER_AGE_MS) {
            batch.push({ envId: env.id, order: ev.order });
            if (!batchTimer) batchTimer = setTimeout(flushBatch, BATCH_MS);
          }
        } else if (ev.kind === 'cancelled') {
          onCancelled(env.id, ev.order);
        }
      }
    };

    // ---- stream (leader only) ---------------------------------------------
    let es: EventSource | null = null;
    let attempt = 0;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDataAt = 0;
    let everLive = false;
    // Remounted (same user) with a resume id: treat the first hello as a
    // reconnect so orders/notifications are revalidated on top of the replay.
    let resumedFromRemount = Boolean(resume.lastEventId);
    let disconnectedSince: number | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const setStatus = (status: 'connecting' | 'live' | 'offline' | 'polling') => {
      leaderStatus = status;
      setLiveStatus({ status, leader: isLeader });
      if (isLeader) post({ kind: 'status', status });
    };

    const emitSynthetic = (phase: 'reconnected' | 'polling') => {
      const env = syntheticEnvelope({ type: 'sync', kind: 'status', scope: 'stream', phase, serverTime: Date.now() });
      handle(env);
      post({ kind: 'env', env });
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPollingIfNeeded = () => {
      if (pollTimer || disconnectedSince === null) return;
      if (Date.now() - disconnectedSince < POLL_AFTER_MS) return;
      setStatus('polling');
      emitSynthetic('polling');
      pollTimer = setInterval(() => emitSynthetic('polling'), POLL_EVERY_MS);
    };

    const markDown = () => {
      if (disconnectedSince === null) disconnectedSince = Date.now();
      if (!pollTimer) setStatus('offline');
    };

    const closeStream = () => {
      if (es) {
        es.onmessage = null;
        es.onerror = null;
        es.close();
      }
      es = null;
    };

    const scheduleReopen = (immediate = false) => {
      if (disposed || !isLeader) return;
      if (reopenTimer) clearTimeout(reopenTimer);
      const delay = immediate ? 0 : Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) * (0.8 + Math.random() * 0.4);
      attempt += 1;
      reopenTimer = setTimeout(() => {
        reopenTimer = null;
        openStream();
      }, delay);
    };

    const openStream = () => {
      if (disposed || !isLeader) return;
      closeStream();
      if (!everLive) setStatus('connecting');
      const resumeId = resume.lastEventId;
      const url = resumeId ? `${STREAM_URL}?lastEventId=${encodeURIComponent(resumeId)}` : STREAM_URL;
      let source: EventSource;
      try {
        source = new EventSource(url, { withCredentials: true });
      } catch {
        markDown();
        scheduleReopen();
        return;
      }
      es = source;
      lastDataAt = Date.now();
      // With a known user, nothing is consumed until the hello proves the
      // stream is that user's (the server sends hello before any data frame).
      let verified = !expectedUserKey;
      source.onmessage = (m: MessageEvent) => {
        if (es !== source) return;
        lastDataAt = Date.now();
        let env: LiveEnvelope | null = null;
        try {
          env = JSON.parse(m.data) as LiveEnvelope;
        } catch {
          return;
        }
        if (!env || !env.event) return;
        const ev = env.event;
        if (ev.type === 'sync' && ev.kind === 'status' && ev.phase === 'hello') {
          if (expectedUserKey && ev.userKey && ev.userKey !== expectedUserKey) {
            // The cookie belongs to another account than this page's session
            // (account switched in another tab): never consume or relay it.
            closeStream();
            markDown();
            scheduleReopen();
            return;
          }
          verified = true;
        }
        if (!verified) return;
        if (m.lastEventId) resume.lastEventId = m.lastEventId;
        if (ev.type === 'sync' && ev.kind === 'status') {
          if (ev.phase === 'hello') {
            attempt = 0;
            const wasDown = (everLive && disconnectedSince !== null) || resumedFromRemount;
            resumedFromRemount = false;
            everLive = true;
            disconnectedSince = null;
            stopPolling();
            setStatus('live');
            if (wasDown) emitSynthetic('reconnected');
          }
          return; // hello/heartbeat are transport-only
        }
        handle(env);
        post({ kind: 'env', env });
      };
      source.onerror = () => {
        // A native reconnect must prove the user again with its own hello.
        verified = !expectedUserKey;
        markDown();
        if (source.readyState === EventSource.CLOSED) {
          // Not retried natively (HTTP error such as 401/502, or aborted): back off ourselves.
          if (es === source) closeStream();
          scheduleReopen();
        }
        // CONNECTING: the browser retries on its own (server sent `retry:`).
      };
    };

    const becomeLeader = () => {
      if (disposed) return;
      isLeader = true;
      setLiveStatus({ leader: true });
      openStream();
      watchdog = setInterval(() => {
        if (disposed) return;
        startPollingIfNeeded();
        if (es && es.readyState === EventSource.OPEN && Date.now() - lastDataAt > IDLE_REOPEN_MS) {
          // Half-open connection (sleep, NAT drop): no heartbeat data for 75 s.
          markDown();
          scheduleReopen(true);
        }
      }, 15_000);
    };

    // ---- wake-ups ----------------------------------------------------------
    const kick = () => {
      if (!isLeader || disposed) return;
      if (!es || es.readyState === EventSource.CLOSED) {
        attempt = 0;
        scheduleReopen(true);
      }
    };
    const onVisibility = () => {
      if (isVisible()) {
        clearUnseen();
        kick();
      }
    };
    const onFocus = () => clearUnseen();
    window.addEventListener('online', kick);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    // ---- election ------------------------------------------------------------
    let releaseLock: (() => void) | null = null;
    const lockAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;

    if (channel) {
      channel.onmessage = (e: MessageEvent<BusMessage>) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.kind === 'env') handle(msg.env);
        else if (msg.kind === 'claim') for (const id of msg.ids || []) claimed.add(id);
        else if (msg.kind === 'status' && !isLeader) setLiveStatus({ status: msg.status, leader: false });
        else if (msg.kind === 'who' && isLeader) post({ kind: 'status', status: leaderStatus });
      };
      post({ kind: 'who' });
    }

    if (channel && locks && typeof locks.request === 'function') {
      setLiveStatus({ status: 'connecting', leader: false });
      locks
        .request(`${LOCK_PREFIX}${scopeKey}`, lockAbort ? { signal: lockAbort.signal } : {}, () => {
          if (disposed) return undefined;
          becomeLeader();
          // Hold the lock for the life of this tab/effect.
          return new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
        })
        .catch(() => {
          /* aborted on unmount */
        });
    } else {
      becomeLeader();
    }

    return () => {
      // Play/toast a pending new-order burst now instead of dropping it.
      if (batchTimer) {
        clearTimeout(batchTimer);
        flushBatch();
      }
      // Trailing SWR runs still owed: do them now rather than lose them.
      for (const p of swrPending) revalidateSwrPrefix(p);
      swrPending.clear();
      disposed = true;
      lockAbort?.abort();
      releaseLock?.();
      closeStream();
      if (reopenTimer) clearTimeout(reopenTimer);
      if (watchdog) clearInterval(watchdog);
      stopPolling();
      for (const tm of swrTimers.values()) clearTimeout(tm);
      swrTimers.clear();
      titleObserver?.disconnect();
      // resume.unseenOrders is kept (a remount re-applies the prefix).
      try {
        document.title = document.title.replace(TITLE_PREFIX_RE, '');
      } catch {
        /* ignore */
      }
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
      setLiveStatus({ status: 'idle', leader: false });
    };
  }, [enabled, scopeKey, expectedUserKey]);

  return <>{children}</>;
}
