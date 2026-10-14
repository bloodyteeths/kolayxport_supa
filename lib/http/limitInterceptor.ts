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
 */
import axios from 'axios';
import { create } from 'zustand';

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

function report(body: unknown, path: string) {
  if (!isLimiterBody(body)) return;
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
          if (isOwnApi(path)) report(res.data, path);
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
          const copy = response.clone();
          copy
            .json()
            .then((body) => report(body, path))
            .catch(() => report(null, path));
        }
      }
    } catch {
      /* never break the caller */
    }
    return response;
  };
  window.fetch = wrappedFetch;
}
