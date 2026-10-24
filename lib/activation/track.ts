// lib/activation/track.ts — browser side of lib/activation/events.ts. Fire-and-forget (sendBeacon survives the
// navigation that follows a connect click). `once` events are sent once per browser tab session.
import type { ActivationEvent, ActivationProvider } from './events';

const KEY = 'kx:activation:sent';

function sentOnce(id: string): boolean {
  try {
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(KEY) || '[]'));
    if (seen.has(id)) return true;
    seen.add(id);
    sessionStorage.setItem(KEY, JSON.stringify(Array.from(seen)));
  } catch {
    /* storage blocked: send anyway */
  }
  return false;
}

export function trackActivation(event: ActivationEvent, opts: { provider?: ActivationProvider; once?: boolean; job?: string; count?: number } = {}): void {
  if (typeof window === 'undefined') return;
  if (opts.once && sentOnce(`${event}:${opts.provider ?? ''}`)) return;
  const body = JSON.stringify({ event, ...(opts.provider ? { provider: opts.provider } : {}), ...(opts.job ? { job: opts.job } : {}), ...(typeof opts.count === 'number' ? { count: opts.count } : {}) });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/activation/event', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    /* fall through */
  }
  void fetch('/api/activation/event', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => undefined);
}
