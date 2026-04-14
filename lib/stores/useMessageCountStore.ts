import { create } from 'zustand';
import type { MessageCountsResponse } from '@/types/messages';

interface MessageCountState {
  counts: MessageCountsResponse;
  loading: boolean;
  fetch: () => Promise<void>;
}

const useMessageCountStore = create<MessageCountState>((set, get) => ({
  counts: { wix: 0, trendyol: 0, total: 0 },
  loading: false,
  fetch: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await fetch('/api/messages?action=counts');
      if (res.ok) {
        const data = await res.json();
        set({ counts: data });
      }
    } catch {
      // silently fail — badge just won't update
    } finally {
      set({ loading: false });
    }
  },
}));

export default useMessageCountStore;
