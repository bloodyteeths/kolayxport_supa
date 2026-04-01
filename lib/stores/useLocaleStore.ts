import { create } from 'zustand';

export type AppLocale = 'tr' | 'en';

interface LocaleState {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
}

const getStoredLocale = (): AppLocale => {
  if (typeof window === 'undefined') return 'tr';
  const stored = localStorage.getItem('kolayxport_locale');
  return stored === 'en' ? 'en' : 'tr';
};

const useLocaleStore = create<LocaleState>((set) => ({
  locale: getStoredLocale(),
  setLocale: (locale) => {
    localStorage.setItem('kolayxport_locale', locale);
    set({ locale });
  },
}));

export default useLocaleStore;
