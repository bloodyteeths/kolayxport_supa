/**
 * Global HTTP 402 (usage limit) detection.
 *
 * lib/middleware/withUsageLimiter.ts answers blocked requests with
 *   402 { error: 'Payment Required', details: 'Trial limit reached.' | 'No active subscription.'
 *         | 'orderSync limit reached for your plan.' | 'label limit reached for your plan.'
 *         | 'Subscription plan not found or invalid. Please contact support.' }
 * (forward-compatible: optional limitType / used / limit / plan fields are read if present).
 *
 * installLimitInterceptor() hooks the default axios instance and window.fetch
 * (same-origin /api/* only). It never consumes the response body for callers
 * (fetch responses are cloned) and never swallows errors — callers still get
 * their 402 response / rejected promise. It only pushes a LimitReachedInfo into
 * useLimitReachedStore, which <LimitReachedDialog/> renders.
 *
 * M2 (shell-nav §12 F, CRITIQUE C6, pro-gating §3.5):
 * - Opt-out. A surface that shows the 402 inline (warning Banner + disabled action) keeps the global dialog
 *   from firing on top of it, in one of three ways: `useLimitDialogOptOut()` while its page is mounted;
 *   the `LIMIT_UI_HEADER: 'inline'` request header on one call; or a route pattern in
 *   `LIMIT_DIALOG_SKIP_ROUTES`. The caller still receives the 402.
 * - `featureLocked`. A 402 `{ limitType: 'feature', reason: 'featureLocked', feature, neutral? }`
 *   (tiers.md `withEntitlement`) never opens the dialog and never toasts: it is recorded in
 *   `useFeatureLockStore`, which the pro gate (M4 `FeatureGate`) reads to swap its region to the locked state.
 */
import { useEffect } from 'react';
import axios from 'axios';
import { create } from 'zustand';
import { showCreditsDialog } from '@/lib/billing/creditsDialogStore';

export type LimitType = 'orderSync' | 'label' | 'unknown';
export type LimitReason = 'trial' | 'noSubscription' | 'planLimit' | 'invalidPlan' | 'unknown';

export interface LimitReachedInfo {
  limitType: LimitType;
  reason: LimitReason;
  /** Raw `details` string from the API (English, not for display). */
  details?: string;
  /** Present only if the API body includes them. Otherwise the dialog fetches usage. */
  used?: number;
  limit?: number;
  plan?: string;
  /** Request path that hit the limit. */
  url?: string;
  at: number;
}

interface LimitReachedState {
  current: LimitReachedInfo | null;
  /** limitType -> timestamp until which re-opening is suppressed (after a dismiss). */
  snoozedUntil: Partial<Record<LimitType, number>>;
  /** When the dialog last actually opened (0 = never). Lets notify.error avoid a duplicate toast. */
  lastShownAt: number;
  show: (info: LimitReachedInfo) => void;
  dismiss: () => void;
}

/** After the user closes the dialog, further 402s of the same type stay quiet this long. */
export const LIMIT_DIALOG_SNOOZE_MS = 60_000;

export const useLimitReachedStore = create<LimitReachedState>((set, get) => ({
  current: null,
  snoozedUntil: {},
  lastShownAt: 0,
  show: (info) => {
    const { current, snoozedUntil } = get();
    if (current) return; // already showing — bulk loops fire many 402s
    if ((snoozedUntil[info.limitType] ?? 0) > Date.now()) return;
    set({ current: info, lastShownAt: Date.now() });
  },
  dismiss: () => {
    const { current, snoozedUntil } = get();
    set({
      current: null,
      snoozedUntil: current
        ? { ...snoozedUntil, [current.limitType]: Date.now() + LIMIT_DIALOG_SNOOZE_MS }
        : snoozedUntil,
    });
  },
}));

/** Non-hook access, e.g. for tests or manual triggering. */
export const showLimitReached = (info: Omit<LimitReachedInfo, 'at'>) =>
  useLimitReachedStore.getState().show({ ...info, at: Date.now() });

function toPath(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    if (typeof window === 'undefined') return url.startsWith('/') ? url : null;
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

function isOwnApi(path: string | null): path is string {
  return !!path && path.startsWith('/api/');
}

function inferLimitType(details: string, path: string | undefined): LimitType {
  const d = details.toLowerCase();
  if (d.startsWith('label')) return 'label';
  if (d.startsWith('ordersync')) return 'orderSync';
  if (path) {
    if (/\/api\/labels\//.test(path) || /generate-label/.test(path)) return 'label';
    if (/\/api\/orders\/sync/.test(path) || /\/api\/integrations\/[^/]+\/(orders|addresses)/.test(path)) return 'orderSync';
  }
  return 'unknown';
}

function inferReason(details: string): LimitReason {
  const d = details.toLowerCase();
  if (d.includes('trial')) return 'trial';
  if (d.includes('no active subscription')) return 'noSubscription';
  if (d.includes('limit reached')) return 'planLimit';
  if (d.includes('plan not found') || d.includes('invalid')) return 'invalidPlan';
  return 'unknown';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Parse a 402 body from withUsageLimiter into LimitReachedInfo. */
export function parseLimitResponse(body: unknown, path?: string): LimitReachedInfo {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const details = typeof b.details === 'string' ? b.details : '';
  const explicitType = b.limitType === 'label' || b.limitType === 'orderSync' ? (b.limitType as LimitType) : null;
  return {
    limitType: explicitType ?? inferLimitType(details, path),
    reason: inferReason(details),
    details: details || undefined,
    used: num(b.used),
    limit: num(b.limit),
    plan: typeof b.plan === 'string' ? b.plan : undefined,
    url: path,
    at: Date.now(),
  };
}

/** Shape check so unrelated 402s (e.g. a third-party proxy) don't open the dialog. */
function isLimiterBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true; // unreadable body from our own /api: assume limiter
  const b = body as Record<string, unknown>;
  return b.error === 'Payment Required' || typeof b.limitType === 'string' || typeof b.details === 'string';
}

// ── featureLocked (pro-gating §3.5) ────────────────────────────────────────────────────────────────

export interface FeatureLockInfo {
  /** Entitlement feature key from the server (e.g. 'financials', 'bulkPhotoStudio', 'arbitrage'). */
  feature: string;
  /** Server hint for the locked copy: true = neutral wording (no "See plans"; Shopify-free / unknown). */
  neutral?: boolean;
  /** Request path that hit the gate. */
  url?: string;
  at: number;
}

interface FeatureLockState {
  /** Latest lock per feature key. */
  locked: Record<string, FeatureLockInfo>;
  markLocked: (info: FeatureLockInfo) => void;
  /** Forget one feature (e.g. after an upgrade) or all of them. */
  clear: (feature?: string) => void;
}

export const useFeatureLockStore = create<FeatureLockState>((set) => ({
  locked: {},
  markLocked: (info) => set((s) => ({ locked: { ...s.locked, [info.feature]: info } })),
  clear: (feature) =>
    set((s) => {
      if (!feature) return { locked: {} };
      if (!(feature in s.locked)) return s;
      const next = { ...s.locked };
      delete next[feature];
      return { locked: next };
    }),
}));

/** `{ limitType: 'feature', reason: 'featureLocked', feature }` → FeatureLockInfo, else null. */
export function parseFeatureLocked(body: unknown, path?: string): FeatureLockInfo | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.reason !== 'featureLocked' && b.limitType !== 'feature') return null;
  const feature = typeof b.feature === 'string' && b.feature ? b.feature : 'unknown';
  return { feature, neutral: typeof b.neutral === 'boolean' ? b.neutral : undefined, url: path, at: Date.now() };
}

// ── Opt-out of the global dialog (CRITIQUE C6) ─────────────────────────────────────────────────────

/** Request header that marks one call as handled inline: `{ [LIMIT_UI_HEADER]: 'inline' }`. */
export const LIMIT_UI_HEADER = 'x-kx-limit-ui';

/**
 * Route patterns (Next `router.pathname` / `location.pathname`) whose pages show 402s inline. '/x' exact,
 * '/x/*' any sub-path. Empty in M2: each migrated surface adds its route here, or calls
 * `useLimitDialogOptOut()`, in the PR that ships its inline Banner. The global dialog is deleted in M10.
 */
export const LIMIT_DIALOG_SKIP_ROUTES: readonly string[] = [];

let optOutCount = 0;

/** Imperative opt-out; returns the release function. Nested calls are counted. */
export function optOutOfLimitDialog(): () => void {
  optOutCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    optOutCount = Math.max(0, optOutCount - 1);
  };
}

/** While the calling component is mounted (and `enabled`), 402s skip the global dialog. */
export function useLimitDialogOptOut(enabled = true): void {
  useEffect(() => (enabled ? optOutOfLimitDialog() : undefined), [enabled]);
}

function routeMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  return path === pattern;
}

/** True when a 402 for this request must not open the global dialog. Pure apart from `location`. */
export function limitDialogSkipped(opts: { inlineHeader?: boolean; pagePath?: string | null } = {}): boolean {
  if (opts.inlineHeader) return true;
  if (optOutCount > 0) return true;
  const page = opts.pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : null);
  if (!page) return false;
  return LIMIT_DIALOG_SKIP_ROUTES.some((p) => routeMatches(p, page));
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  try {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
    if (Array.isArray(headers)) {
      const hit = headers.find((h) => Array.isArray(h) && String(h[0]).toLowerCase() === name);
      return hit ? String(hit[1]) : null;
    }
    if (typeof headers === 'object') {
      const rec = headers as Record<string, unknown> & { get?: (n: string) => unknown };
      if (typeof rec.get === 'function') {
        const v = rec.get(name);
        if (v != null) return String(v);
      }
      for (const [k, v] of Object.entries(rec)) if (k.toLowerCase() === name && v != null) return String(v);
    }
  } catch {
    /* unreadable headers: treat as absent */
  }
  return null;
}

function isInline(headers: unknown): boolean {
  return headerValue(headers, LIMIT_UI_HEADER) === 'inline';
}

function report(body: unknown, path: string, inlineHeader = false) {
  // Image / video generation out of AI kredisi → the "buy credits" dialog (components/domain/credits/CreditsDialog).
  if (body && typeof body === 'object' && (body as Record<string, unknown>).limitType === 'aiCredit') {
    const need = (body as Record<string, unknown>).need;
    showCreditsDialog(typeof need === 'number' ? need : null);
    return;
  }
  const locked = parseFeatureLocked(body, path);
  if (locked) {
    useFeatureLockStore.getState().markLocked(locked);
    return;
  }
  if (!isLimiterBody(body)) return;
  if (limitDialogSkipped({ inlineHeader })) return;
  useLimitReachedStore.getState().show(parseLimitResponse(body, path));
}

declare global {
  interface Window {
    __kxLimitInterceptorInstalled?: boolean;
  }
}

/**
 * Install once on the client (module scope of pages/_app.tsx, so it is active
 * before any page effect fires). Idempotent across HMR re-evaluation.
 */
export function installLimitInterceptor(): void {
  if (typeof window === 'undefined' || window.__kxLimitInterceptorInstalled) return;
  window.__kxLimitInterceptorInstalled = true;

  // axios — default instance only (axios.create() instances are not covered).
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      try {
        const res = error?.response;
        if (res?.status === 402) {
          const path = toPath(res.config?.url ?? error?.config?.url);
          // axios resolves relative URLs against baseURL; treat relative as own origin.
          if (isOwnApi(path)) report(res.data, path, isInline(res.config?.headers ?? error?.config?.headers));
        }
      } catch {
        /* never break the caller's error path */
      }
      return Promise.reject(error);
    }
  );

  // fetch — inspect status only; read a CLONE so the caller's body is untouched.
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  const wrappedFetch: typeof window.fetch = async (input, init) => {
    const response = await originalFetch.call(window, input, init);
    try {
      if (response.status === 402) {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url;
        const path = toPath(rawUrl);
        if (isOwnApi(path)) {
          const inline = isInline(init?.headers) || (typeof Request !== 'undefined' && input instanceof Request && isInline(input.headers));
          const copy = response.clone();
          copy
            .json()
            .then((body) => report(body, path, inline))
            .catch(() => report(null, path, inline));
        }
      }
    } catch {
      /* never break the caller */
    }
    return response;
  };
  window.fetch = wrappedFetch;
}
