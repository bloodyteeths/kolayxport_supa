/**
 * App-wide toast helpers.
 *
 *   notify.error(err)                       // axios / fetch / Error / string
 *   notify.error(err, 'etsy.saveFailed')    // fallback = i18n key (dotted, from messages/*.json)
 *   notify.error(err, 'Literal fallback')   // or a literal (already translated) string
 *   notify.success('Saved')
 *
 * Rules: messages are short (<= 140 chars), never JSON/objects/arrays/HTML,
 * identical toasts are deduped (same toast id => the existing toast updates
 * instead of stacking). 402 usage-limit errors are skipped by notify.error
 * because the global LimitReachedDialog (lib/http/limitInterceptor.ts)
 * already tells the user.
 */
import { toast, type ToastOptions } from 'react-hot-toast';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { cachedMessages, loadMessages } from '@/lib/i18n/clientMessages';
import { useLimitReachedStore } from '@/lib/http/limitInterceptor';

const MAX_LEN = 140;

/** Resolve a dotted i18n key against the current locale's messages (non-hook). */
export function translateKey(key: string, fallback?: string): string {
  const locale = (useLocaleStore.getState().locale || 'tr') as 'tr' | 'en';
  // The dictionary is loaded by pages/_app.tsx before app screens render; on public pages it may not be yet.
  const messages = cachedMessages(locale);
  if (!messages) void loadMessages(locale);
  const lookup = (root: unknown): string | null => {
    let node: unknown = root;
    for (const part of key.split('.')) {
      if (!node || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : null;
  };
  return lookup(messages) ?? fallback ?? key;
}

const DEFAULT_FALLBACK_KEY = 'errors.unexpectedError';
const DEFAULT_FALLBACK_TEXT = 'An unexpected error occurred. Please try again.';

/** Looks like a dotted i18n key (e.g. "errors.unexpectedError"), not prose. */
function looksLikeKey(s: string): boolean {
  return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(s);
}

function resolveFallback(fallbackKey?: string): string {
  if (fallbackKey) {
    if (looksLikeKey(fallbackKey)) {
      const resolved = translateKey(fallbackKey, '');
      if (resolved) return resolved;
    } else {
      return fallbackKey;
    }
  }
  return translateKey(DEFAULT_FALLBACK_KEY, DEFAULT_FALLBACK_TEXT);
}

/** Technical messages that mean nothing to a seller — replaced by the fallback. */
const TECHNICAL_PATTERNS: RegExp[] = [
  /^request failed with status code \d+/i,
  /^network ?error$/i,
  /^failed to fetch$/i,
  /^load failed$/i,
  /^networkerror when attempting to fetch resource/i,
  /^timeout of \d+ms exceeded/i,
  /^unexpected token/i,
  /is not valid json/i,
  /^\[object \w+\]$/,
  /^(undefined|null)$/i,
  /prisma|ECONNREFUSED|ETIMEDOUT|stack trace|at .+\(.+:\d+:\d+\)/i,
];

const NETWORK_PATTERNS = [/^network ?error$/i, /^failed to fetch$/i, /^load failed$/i, /networkerror/i];

/** Clean a candidate string; returns null if unusable for a user-facing toast. */
export function sanitizeMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.startsWith('{') || s.startsWith('[') || /<\/?[a-z][\s\S]*>/i.test(s)) return null;
  if (TECHNICAL_PATTERNS.some((re) => re.test(s))) return null;
  return truncate(s, MAX_LEN);
}

export function truncate(s: string, max = MAX_LEN): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function pickFromBody(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === 'string') return sanitizeMessage(body);
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  // `error` is the user-facing field in this codebase; `details` is often a raw
  // exception message, so it comes last.
  for (const field of ['error', 'message', 'msg', 'details']) {
    const v = b[field];
    if (typeof v === 'string') {
      const clean = sanitizeMessage(v);
      if (clean) return clean;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = (v as Record<string, unknown>).message;
      const clean = sanitizeMessage(nested);
      if (clean) return clean;
    }
  }
  return null;
}

/** HTTP status from axios errors, fetch Responses, or `{ status }` objects. */
export function getErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, any>;
  const status = e.response?.status ?? e.status ?? e.statusCode;
  return typeof status === 'number' ? status : null;
}

/** True for the withUsageLimiter 402 payload (handled by LimitReachedDialog). */
export function isUsageLimitError(err: unknown): boolean {
  return getErrorStatus(err) === 402;
}

/**
 * Extract a short, safe, user-facing message from anything thrown.
 * Order: axios response body -> SWR-style `info`/`data` -> Error.message -> string.
 */
export function getErrorMessage(err: unknown, fallbackKey?: string): string {
  const fallback = resolveFallback(fallbackKey);
  if (err == null) return fallback;
  if (typeof err === 'string') return sanitizeMessage(err) ?? fallback;
  if (typeof err !== 'object') return fallback;

  const e = err as Record<string, any>;
  const fromBody =
    pickFromBody(e.response?.data) ?? pickFromBody(e.info) ?? pickFromBody(e.data) ?? pickFromBody(e.body);
  if (fromBody) return fromBody;

  if (typeof e.message === 'string') {
    if (NETWORK_PATTERNS.some((re) => re.test(e.message.trim()))) {
      return translateKey('ui.notify.network', 'Network error. Check your connection and try again.');
    }
    const clean = sanitizeMessage(e.message);
    if (clean) return clean;
  }
  // Plain `{ error: '...' }` objects (e.g. an already-parsed JSON body).
  const direct = pickFromBody(e);
  return direct ?? fallback;
}

/** Wait this long for the 402 dialog before falling back to a toast. */
const LIMIT_TOAST_GRACE_MS = 400;

function toastId(kind: string, message: string): string {
  return `notify:${kind}:${message}`;
}

export const notify = {
  /** Error toast with a safe message. Skips 402 usage-limit errors (dialog handles them). */
  error(err: unknown, fallbackKey?: string, options?: ToastOptions & { force402?: boolean }): string | null {
    if (isUsageLimitError(err) && !options?.force402) {
      // The dialog normally covers this, but it stays closed when another one is open,
      // the type is snoozed after a dismiss, or the URL isn't intercepted. Fetch 402s are
      // reported asynchronously (body read from a clone), so check after a short delay
      // and fall back to one short deduped toast if no dialog opened — never silent.
      if (typeof window !== 'undefined') {
        const startedAt = Date.now();
        window.setTimeout(() => {
          const { current, lastShownAt } = useLimitReachedStore.getState();
          if (current || lastShownAt >= startedAt - LIMIT_TOAST_GRACE_MS) return;
          toast.error(translateKey('subscription.limitExceeded', 'Limit Exceeded'), {
            id: 'limit-reached-toast',
            duration: 5000,
          });
        }, LIMIT_TOAST_GRACE_MS);
      }
      return null;
    }
    const message = getErrorMessage(err, fallbackKey);
    const { force402: _ignored, ...toastOptions } = options || {};
    return toast.error(message, { id: toastId('error', message), duration: 5000, ...toastOptions });
  },
  /** Success toast; `message` may be a dotted i18n key or literal text. */
  success(message: string, options?: ToastOptions): string {
    const text = truncate(looksLikeKey(message) ? translateKey(message, message) : message);
    return toast.success(text, { id: toastId('success', text), duration: 2500, ...options });
  },
  /** Neutral toast; `message` may be a dotted i18n key or literal text. */
  info(message: string, options?: ToastOptions): string {
    const text = truncate(looksLikeKey(message) ? translateKey(message, message) : message);
    return toast(text, { id: toastId('info', text), duration: 4000, ...options });
  },
  dismiss(id?: string) {
    toast.dismiss(id);
  },
};

export default notify;
