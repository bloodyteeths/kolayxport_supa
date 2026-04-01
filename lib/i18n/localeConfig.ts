import type { AppLocale } from '../stores/useLocaleStore';

export interface LocaleConfig {
  intlLocale: string;
  defaultCountryOfOrigin: string;
  defaultSoldToCountry: string;
  defaultCurrency: string;
  defaultEtsyFeeRegion: 'tr' | 'us';
  etgbProminence: 'prominent' | 'collapsed';
  currencyListFirst: string;
  monthsShort: string[];
  monthsFull: string[];
}

export const TR_CONFIG: LocaleConfig = {
  intlLocale: 'tr-TR',
  defaultCountryOfOrigin: 'TR',
  defaultSoldToCountry: 'TR',
  defaultCurrency: 'TRY',
  defaultEtsyFeeRegion: 'tr',
  etgbProminence: 'prominent',
  currencyListFirst: 'TRY',
  monthsShort: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  monthsFull: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
};

export const EN_CONFIG: LocaleConfig = {
  intlLocale: 'en-US',
  defaultCountryOfOrigin: '',
  defaultSoldToCountry: '',
  defaultCurrency: 'USD',
  defaultEtsyFeeRegion: 'us',
  etgbProminence: 'collapsed',
  currencyListFirst: 'USD',
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsFull: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

export function getLocaleConfig(locale: AppLocale): LocaleConfig {
  return locale === 'tr' ? TR_CONFIG : EN_CONFIG;
}
