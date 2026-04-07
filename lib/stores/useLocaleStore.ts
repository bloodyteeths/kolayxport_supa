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
    const stored = localStorage.getItem('kolayxport_locale');
    const locale: AppLocale = stored === 'en' ? 'en' : 'tr';
    set({ locale, hydrated: true });
  },
}));

export default useLocaleStore;
