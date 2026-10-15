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
 * - `src` must read at 16–20 px (sidebar, chips, table cells). Trendyol's owner file is a wide raster wordmark
 *   that is illegible that small, so its `src` is a SQUARE tile and the wordmark is kept in `wordmarkSrc`.
 * - `wordmarkSrc` / `fullBleed` / `logoSrc()` are registry data for a pending LogoTile change
 *   (components/ds/data/LogoTile.tsx, M1-d owned): LogoTile does NOT read them yet. Today it always draws
 *   `src` (or `monoSrc`) inside its white bordered frame at every size. Once LogoTile adopts them it should draw
 *   `logoSrc(asset, size, tone)` and skip the frame (border, padding) when `fullBleed` is set.
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
  /** Wide wordmark for large uses (>= 32 px). Absent when `src` already reads at every size. Not yet read by LogoTile. */
  wordmarkSrc?: string;
  /** `src` is a self-contained filled tile that should render full-bleed (no white frame). Not yet read by LogoTile. */
  fullBleed?: boolean;
};

/** Smallest tile size at which a wide wordmark (`wordmarkSrc`) is legible. */
export const WORDMARK_MIN_SIZE = 32;

const L = (
  provider: LogoProvider,
  name: string,
  initials: string,
  kind: LogoAsset['kind'],
  src = `/logos/${provider}.svg`,
  extra: Partial<Pick<LogoAsset, 'monoSrc' | 'wordmarkSrc' | 'fullBleed'>> = {},
): LogoAsset => ({
  provider,
  src,
  monoSrc: `/logos/${provider}-mono.svg`,
  name,
  color: brand[provider],
  initials,
  kind,
  ...extra,
});

export const LOGOS: Record<LogoProvider, LogoAsset> = {
  etsy: L('etsy', 'Etsy', 'E', 'mark'),
  // The four-color "ebay" letters, as shell-nav §1 specifies. A red-"e"-only square was tried for 16 px
  // legibility but needs a founder decision (it is not the spec'd mark), so it is not shipped.
  ebay: L('ebay', 'eBay', 'e', 'mark'),
  amazon: L('amazon', 'Amazon', 'A', 'mark'),
  shopify: L('shopify', 'Shopify', 'S', 'mark'),
  wix: L('wix', 'Wix', 'W', 'mark'),
  // The "trendyol .com" raster wordmark is unreadable below ~32 px: `src` is a square orange tile with a white
  // "t" (shell-nav §1 "the orange t tile"; KolayXport-drawn in the brand color, hence `monogram`;
  // design/logos/SOURCES.md). The raster wordmark is kept as `wordmarkSrc` for the pending LogoTile change.
  trendyol: L('trendyol', 'Trendyol', 'T', 'monogram', '/logos/trendyol-square.svg', {
    monoSrc: '/logos/trendyol-square-mono.svg',
    wordmarkSrc: '/logos/trendyol.png',
    fullBleed: true,
  }),
  // Existing official-looking raster file; the mono variant is a monogram.
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

/**
 * The asset path a tile of `size` px should draw: the mono file for `tone: 'mono'`, the wide wordmark at
 * >= WORDMARK_MIN_SIZE when one exists, otherwise the square `src`. Not yet called by LogoTile (see header).
 */
export function logoSrc(asset: LogoAsset, size: number, tone: 'color' | 'mono' = 'color'): string {
  if (tone === 'mono') return asset.monoSrc;
  if (asset.wordmarkSrc && size >= WORDMARK_MIN_SIZE) return asset.wordmarkSrc;
  return asset.src;
}

/** Glossary name for the domestic carrier integration (MNG Kargo is now DHL eCommerce). */
export const DHL_ECOMMERCE_NAME = 'DHL eCommerce';

/**
 * The proper-noun name to show for a raw provider string. Same as `getLogo(raw).name`, except that the
 * MNG / DHL eCommerce integration is named "DHL eCommerce" (glossary) while sharing the DHL mark.
 */
export function logoDisplayName(raw: string | null | undefined): string | null {
  const asset = getLogo(raw);
  if (!asset) return null;
  if (asset.provider === 'dhl') {
    const compact = String(raw).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compact.startsWith('mng') || compact.startsWith('dhlecommerce')) return DHL_ECOMMERCE_NAME;
  }
  return asset.name;
}
