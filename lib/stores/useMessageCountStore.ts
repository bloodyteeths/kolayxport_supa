import { create } from 'zustand';
import type { MessageCountsResponse } from '@/types/messages';

interface MessageCountFetchOptions {
  /** Bypass the in-flight guard (e.g. right after a reply) so the badge reflects the latest state. */
  force?: boolean;
}

interface MessageCountState {
  counts: MessageCountsResponse;
  loading: boolean;
  /**
   * Client time (ms) of the last successful counts response; null until one arrives. Overview's "Needs reply"
   * KPI shows it as `asOf` and renders only once it is set (overview §3.1, §4.4).
   */
  fetchedAt: number | null;
  /**
   * True when the latest settled request failed (network error, non-2xx or a malformed body). `counts` keeps the
   * last good values for the badge, but a KPI must show `—`, never `0` (P6). Reset by the next success.
   */
  failed: boolean;
  fetch: (opts?: MessageCountFetchOptions) => Promise<void>;
  /** Optimistically decrement one platform's unread count (e.g. after answering). */
  decrement: (platform: 'wix' | 'trendyol' | 'hepsiburada') => void;
}

// Monotonic request id: only the latest response may write counts, so a slow
// pre-reply request can't overwrite a fresher post-reply one.
let latestRequestId = 0;

const useMessageCountStore = create<MessageCountState>((set, get) => ({
  counts: { wix: 0, trendyol: 0, hepsiburada: 0, total: 0 },
  loading: false,
  fetchedAt: null,
  failed: false,
  fetch: async (opts) => {
    // setInterval may pass a non-object arg in some runtimes; only honour a real options object.
    const force = !!(opts && typeof opts === 'object' && opts.force);
    if (get().loading && !force) return;
    const requestId = ++latestRequestId;
    set({ loading: true });
    try {
      const res = await fetch('/api/messages?action=counts');
      if (requestId !== latestRequestId) return;
      if (!res.ok) {
        set({ failed: true });
        return;
      }
      const data = await res.json();
      if (requestId !== latestRequestId) return;
      if (data && typeof data.total === 'number') set({ counts: data, fetchedAt: Date.now(), failed: false });
      else set({ failed: true });
    } catch {
      // The badge keeps its last value; consumers that show a number read `failed` (never a fake 0).
      if (requestId === latestRequestId) set({ failed: true });
    } finally {
      if (requestId === latestRequestId) set({ loading: false });
    }
  },
  decrement: (platform) => {
    const { counts } = get();
    const next = { ...counts, [platform]: Math.max(0, (counts[platform] || 0) - 1) };
    next.total = next.wix + next.trendyol + (next.hepsiburada || 0);
    set({ counts: next });
  },
}));

export default useMessageCountStore;
