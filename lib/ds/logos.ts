/**
 * Marketplace / carrier / service logo registry (DS §3.11, consumed by `LogoTile`).
 *
 * - `src`     full-color asset for a white tile (real mark where we have one).
 * - `monoSrc` single-color asset (`fill="currentColor"`) for the collapsed rail.
 *   NOTE: `currentColor` does NOT inherit through `<img src>`; to tint it, render it as a
 *   CSS mask (`mask-image: url(monoSrc); background-color: currentColor`) or inline the SVG.
 * - `color`   brand hex from `tokens.brand` (monogram fallback background only, never UI chrome).
 * - `kind`    `'mark'` = the owner's logo (simple-icons / existing official file);
 *             `'monogram'` = a KolayXport-drawn letter tile, NOT the owner's logo.
 *
 * Sources and license notes: design/logos/SOURCES.md.
 */
import { brand } from './tokens';

export type LogoProvider =
  | 'etsy'
  | 'ebay'
  | 'amazon'
  | 'shopify'
  | 'wix'
  | 'trendyol'
  | 'hepsiburada'
  | 'fedex'
  | 'ups'
  | 'dhl'
  | 'veeqo'
  | 'shippo'
  | 'parasut'
  | 'google';

export type LogoAsset = {
  provider: LogoProvider;
  /** Full-color asset path under /public. */
  src: string;
  /** Monochrome (`currentColor`) asset path under /public. */
  monoSrc: string;
  /** Accessible name, used as the tile's `aria-label` / `alt`. Proper noun, not translated. */
  name: string;
  /** Brand hex (from tokens.brand). */
  color: string;
  /** Initials for the monogram fallback. */
  initials: string;
  /** Whether `src` is the owner's mark or our own monogram tile. */
  kind: 'mark' | 'monogram';
};

const L = (
  provider: LogoProvider,
  name: string,
  initials: string,
  kind: LogoAsset['kind'],
  src = `/logos/${provider}.svg`,
): LogoAsset => ({
  provider,
  src,
  monoSrc: `/logos/${provider}-mono.svg`,
  name,
  color: brand[provider],
  initials,
  kind,
});

export const LOGOS: Record<LogoProvider, LogoAsset> = {
  etsy: L('etsy', 'Etsy', 'E', 'mark'),
  ebay: L('ebay', 'eBay', 'e', 'mark'),
  amazon: L('amazon', 'Amazon', 'A', 'mark'),
  shopify: L('shopify', 'Shopify', 'S', 'mark'),
  wix: L('wix', 'Wix', 'W', 'mark'),
  // Existing official-looking raster files; mono variants are monograms.
  trendyol: L('trendyol', 'Trendyol', 'T', 'mark', '/logos/trendyol.png'),
  hepsiburada: L('hepsiburada', 'Hepsiburada', 'H', 'mark', '/logos/hepsiburada.png'),
  fedex: L('fedex', 'FedEx', 'F', 'mark'),
  ups: L('ups', 'UPS', 'U', 'mark'),
  // Used for DHL eCommerce (MNG Kargo) too.
  dhl: L('dhl', 'DHL', 'D', 'mark'),
  // Not in simple-icons and no official asset in the repo: KolayXport monogram tiles.
  veeqo: L('veeqo', 'Veeqo', 'V', 'monogram'),
  shippo: L('shippo', 'Shippo', 'S', 'monogram'),
  parasut: L('parasut', 'Paraşüt', 'P', 'monogram'),
  google: L('google', 'Google', 'G', 'mark'),
};

const ALIASES: Record<string, LogoProvider> = {
  'paraşüt': 'parasut',
  hb: 'hepsiburada',
  'dhl-ecommerce': 'dhl',
  dhl_ecommerce: 'dhl',
  dhlecommerce: 'dhl',
  mng: 'dhl',
  'mng-kargo': 'dhl',
  mngkargo: 'dhl',
  fedex_api: 'fedex',
  amazon_sp: 'amazon',
  'amazon-sp-api': 'amazon',
};

/** Normalizes a raw marketplace / carrier string ("Etsy", "DHL eCommerce", "MNG") to a provider key. */
export function toLogoProvider(raw: string | null | undefined): LogoProvider | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (key in LOGOS) return key as LogoProvider;
  if (key in ALIASES) return ALIASES[key];
  const compact = key.replace(/[^a-z0-9ğüşıöç]/g, '');
  if (compact in LOGOS) return compact as LogoProvider;
  if (compact in ALIASES) return ALIASES[compact];
  if (compact.startsWith('dhl') || compact.startsWith('mng')) return 'dhl';
  return null;
}

/** Returns the logo for a provider (or a raw marketplace/carrier string), or `null` if unknown. */
export function getLogo(provider: LogoProvider): LogoAsset;
export function getLogo(provider: string | null | undefined): LogoAsset | null;
export function getLogo(provider: string | null | undefined): LogoAsset | null {
  const key = toLogoProvider(provider);
  return key ? LOGOS[key] : null;
}
