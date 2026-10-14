import { create } from 'zustand';
import {
  DEFAULT_EBAY_MARKETPLACE,
  isEbayResearchMarketplace,
  type EbayResearchMarketplace,
} from '@/components/ebay/research/marketplaces';

const STORAGE_KEY = 'kx:ebayResearch:marketplace';

interface EbayResearchState {
  /** Marketplace every eBay research tool searches and prices in. */
  marketplace: EbayResearchMarketplace;
  setMarketplace: (marketplace: string) => void;
  /** True once the remembered marketplace has been read (client only). */
  hydrated: boolean;
  /** Load the remembered marketplace (client only; call from an effect). */
  hydrate: () => void;
}

const useEbayResearchStore = create<EbayResearchState>((set) => ({
  marketplace: DEFAULT_EBAY_MARKETPLACE,
  hydrated: false,
  setMarketplace: (marketplace) => {
    if (!isEbayResearchMarketplace(marketplace)) return;
    set({ marketplace });
    try { window.localStorage.setItem(STORAGE_KEY, marketplace); } catch { /* private mode */ }
  },
  hydrate: () => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isEbayResearchMarketplace(saved)) set({ marketplace: saved, hydrated: true });
      else set({ hydrated: true });
    } catch {
      /* private mode */
      set({ hydrated: true });
    }
  },
}));

export default useEbayResearchStore;
