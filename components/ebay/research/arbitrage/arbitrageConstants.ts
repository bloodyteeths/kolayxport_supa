export const VERDICT_CONFIG = {
  excellent: { color: '#2e7d32', bg: '#e8f5e9', label: 'Mükemmel', icon: '🏆' },
  good: { color: '#1565c0', bg: '#e3f2fd', label: 'İyi', icon: '👍' },
  marginal: { color: '#e65100', bg: '#fff3e0', label: 'Marjinal', icon: '⚠️' },
  skip: { color: '#c62828', bg: '#ffebee', label: 'Atla', icon: '❌' },
} as const;

export const CATEGORY_GROUPS = [
  { key: 'Ev & Dekor', label: 'Ev & Dekor', icon: '🏠' },
  { key: 'Mutfak', label: 'Mutfak', icon: '🍽️' },
  { key: 'Takı & Aksesuar', label: 'Takı & Aksesuar', icon: '💎' },
  { key: 'Tekstil', label: 'Tekstil & Çanta', icon: '👜' },
  { key: 'Yiyecek', label: 'Yiyecek & Gurme', icon: '🍯' },
  { key: 'Kozmetik', label: 'Kozmetik & Bakım', icon: '🧴' },
  { key: 'Hediyelik', label: 'Hediyelik & El Sanatları', icon: '🎁' },
] as const;

export const SCAN_PRESETS = [
  { label: 'En Popüler', description: 'Havlu, Peştemal, Çini, Kilim', slugs: ['havlu-x-c104073', 'pestemal-x-c104074', 'kilim-x-c104037', 'seramik-cini-x-c104165', 'lamba-x-c104155'] },
  { label: 'Yüksek Kar', description: 'Takı, Deri, Gümüş, Bakır', slugs: ['gumus-kolye-x-c104279', 'gumus-yuzuk-x-c104280', 'deri-canta-x-c103891', 'bakir-cezve-x-c104262', 'taki-seti-x-c104256'] },
  { label: 'Hafif & Küçük', description: 'Sabun, Lokum, Baharat, Nazar', slugs: ['el-yapimi-sabun-x-c104389', 'lokum-x-c104301', 'baharat-x-c103966', 'nazar-boncugu-x-c104271', 'magnet-x-c104148'] },
  { label: 'Mutfak', description: 'Seramik, Bardak, Cezve, Çaydanlık', slugs: ['seramik-tabak-x-c104209', 'seramik-kase-x-c104210', 'cay-bardagi-x-c104217', 'bakir-cezve-x-c104262', 'caydanlik-x-c104220'] },
] as const;

export function formatCurrency(val: number, currency = 'USD'): string {
  if (currency === 'TRY') return `₺${val.toFixed(2)}`;
  return `$${val.toFixed(2)}`;
}

export function formatPercent(val: number): string {
  return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
}

export function getVerdictConfig(verdict: string) {
  return VERDICT_CONFIG[verdict as keyof typeof VERDICT_CONFIG] || VERDICT_CONFIG.skip;
}
