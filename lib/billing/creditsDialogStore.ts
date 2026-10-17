// lib/billing/creditsDialogStore.ts — opens the "buy AI kredisi" dialog from anywhere: the global 402 interceptor
// (limitType 'aiCredit' from image / video generation) and every "Kredi al" button. Client-safe, React-free store.
import { create } from 'zustand';

interface CreditsDialogState {
  open: boolean;
  /** Credits the blocked action needed (shown in the dialog); null when opened from a button. */
  need: number | null;
  show: (need?: number | null) => void;
  close: () => void;
}

export const useCreditsDialog = create<CreditsDialogState>((set) => ({
  open: false,
  need: null,
  show: (need = null) => set({ open: true, need: typeof need === 'number' && need > 0 ? need : null }),
  close: () => set({ open: false, need: null }),
}));

export const showCreditsDialog = (need?: number | null) => useCreditsDialog.getState().show(need);
