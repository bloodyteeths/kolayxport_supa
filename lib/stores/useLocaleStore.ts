import { create } from 'zustand';

export type AppLocale = 'tr' | 'en';

interface LocaleState {
  locale: AppLocale;
  hydrated: boolean;
  setLocale: (locale: AppLocale) => void;
  hydrate: () => void;
}

// Always start with 'tr' to match SSR — avoids hydration mismatch.
// Call hydrate() in useEffect to read localStorage after mount.
const useLocaleStore = create<LocaleState>((set) => ({
  locale: 'tr',
  hydrated: false,
  setLocale: (locale) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('kolayxport_locale', locale);
    }
    set({ locale });
  },
  hydrate: () => {
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('kolayxport_locale');
    } catch {
      /* storage blocked */
    }
    const fromQuery = new URLSearchParams(window.location.search).get('lang');
    let locale: AppLocale;
    if (fromQuery === 'en' || fromQuery === 'tr') {
      locale = fromQuery;
      try {
        localStorage.setItem('kolayxport_locale', locale);
      } catch {
        /* storage blocked */
      }
    } else if (stored === 'en' || stored === 'tr') {
      locale = stored;
    } else {
      // No saved choice: Turkish browsers get Turkish, everyone else (e.g. a
      // Shopify merchant or App Store reviewer landing after install) gets English.
      const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
      locale = langs.some((l) => l?.toLowerCase().startsWith('tr')) ? 'tr' : 'en';
    }
    set({ locale, hydrated: true });
  },
}));

export default useLocaleStore;
