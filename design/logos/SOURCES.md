# Logo sources

Assets live in `public/logos/` and are resolved through `lib/ds/logos.ts` (`getLogo(provider)`).
Every provider has a full-color file (`<name>.svg`, or the existing `.png`) and a monochrome file (`<name>-mono.svg`, `fill="currentColor"`).
All SVGs use `viewBox="0 0 24 24"` and carry `role="img"` and a `<title>`. They were checked with `xmllint --noout` and rendered with sharp/librsvg at 16px and 120px.

**License.** simple-icons SVG files are released under **CC0 1.0** (https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md). CC0 covers only the drawing. **The trademarks still belong to their owners**, and each owner's brand guidelines still apply. simple-icons' own disclaimer says some brands restrict how their marks can be used (https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md). See `design/launch/brand.md` for each brand's usage rules and the permission status. The founder decided to show real logos inside the app; that decision does not grant permission from the brand owners.

## Simple-icons marks (`kind: 'mark'`)

The paths are copied unchanged from simple-icons. We changed only the fill colors. For a few brands we also split the single path into its color regions with a clip path or by separating its existing subpaths. No geometry was redrawn.

| Asset | Source | simple-icons hex | Our color treatment | Brand guideline |
|---|---|---|---|---|
| `etsy.svg`, `etsy-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/etsy.svg | `F16521` | `#F1641E` (tokens.brand) | https://www.etsy.com/uk/press |
| `ebay.svg`, `ebay-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/ebay.svg | `E53238` | Four-color wordmark (`#E53238` / `#0064D2` / `#F5AF02` / `#86B817`), split by clip rects at x = 6.1, 12.4, 17.95 | https://go.developer.ebay.com/logos |
| `amazon.svg`, `amazon-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@14.15.0/icons/amazon.svg (**removed from simple-icons in v15**; the last version that has it is 14.x) | `FF9900` | "a" in `#221F1F`, smile in `#FF9900` (clip at y = 16.7) | https://www.amazon.com/gp/help/customer/display.html?nodeId=GNYNL3A8HPATWCH8 |
| `shopify.svg`, `shopify-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/shopify.svg | `7AB55C` | `#95BF47` (tokens.brand) | https://www.shopify.com/brand-assets |
| `shopify.jpg` | Rendered from `shopify.svg` (512×512, white background) | n/a | It replaces the old 1280×363 JPEG, so the existing `/logos/shopify.jpg` references keep working | n/a |
| `wix.svg`, `wix-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/wix.svg | `0C6EFC` | `#000000` (the wordmark is black; tokens.brand) | https://www.wix.com/about/design-assets |
| `fedex.svg`, `fedex-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/fedex.svg | `4D148C` | "Fed" and ® in `#4D148C`, solid "Ex" in `#FF6200`. The color file uses subpaths 4–6, the inner "Ex" contours. The mono file keeps simple-icons' outlined "Ex" | https://newsroom.fedex.com, https://brand.fedex.com |
| `ups.svg`, `ups-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/ups.svg | `150400` | Shield in `#351C15`. The letter knockouts (subpaths 0, 2–4, even-odd) are refilled in `#FFB500` | https://www.ups.com |
| `dhl.svg`, `dhl-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/dhl.svg | `FFCC00` | `#D40511` wordmark scaled 0.875 on a `#FFCC00` rounded field. Also used for DHL eCommerce / MNG Kargo | https://www.dpdhl-brands.com/dhl/en/guides/design-basics/logo-and-claim.html |
| `google.svg`, `google-mono.svg` | https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/google.svg | `4285F4` | Single color `#4285F4`, not the four-color G | https://about.google/brand-resource-center/brand-elements/ |

Brand hex data: https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/data/simple-icons.json (Amazon: `@14.15.0/_data/simple-icons.json`).

## Existing raster marks (kept)

| Asset | Source | Note |
|---|---|---|
| `trendyol.png` | Already in the repo (600×600, source unknown) | Looks like the current official "trendyol .com" wordmark. No longer `src`: too small to read below about 32px. Kept as `wordmarkSrc` in `lib/ds/logos.ts` for large tiles once `LogoTile` reads it (pending; today `LogoTile` draws `trendyol-square.svg` at every size). |
| `hepsiburada.png` | Already in the repo (600×600, source unknown) | Looks like the official ring logo. Kept as `src`. |

## KolayXport monogram tiles (`kind: 'monogram'`, NOT the owners' logos)

We drew these ourselves: a rounded 24×24 tile with one stroked letter. They contain no wordmark and no traced artwork. Replace them with official files once the owners supply them (Veeqo is an Amazon company, see the Amazon row in `brand.md`).

| Asset | Letter | Color | Why |
|---|---|---|---|
| `veeqo.svg`, `veeqo-mono.svg` | V | `#2A2E3B` | Not in simple-icons; no repo asset |
| `shippo.svg`, `shippo-mono.svg` | S | `#1B9C85` | Not in simple-icons; no repo asset |
| `parasut.svg`, `parasut-mono.svg` | P | `#00A1E4` | Not in simple-icons; no repo asset |
| `trendyol-square.svg` | t (lowercase, stroked) | `#F27A1A` (tokens.brand) on a rounded 24×24 tile, white letter | Trendyol's `src` since 2026-10 (shell-nav §1 "the orange t tile"). Drawn by KolayXport, not traced from Trendyol artwork, so the registry `kind` changed from `'mark'` to `'monogram'`. Registry flag `fullBleed: true` (the file is already a filled tile; `LogoTile` still frames it until it reads the flag) |
| `trendyol-square-mono.svg` | t | currentColor | Mono variant of `trendyol-square.svg` (letter knocked out with a `<mask>`); Trendyol's `monoSrc` |
| `trendyol-mono.svg` | T | currentColor | Older mono monogram; no longer referenced by the registry (superseded by `trendyol-square-mono.svg`) |
| `hepsiburada-mono.svg` | H | currentColor | Mono variant only; the color file is the PNG above |

The mono monograms use an SVG `<mask>` to knock the letter out of a `currentColor` tile.

## Removed (unreferenced, unofficial)

`public/logos/n11.png`, `public/logos/woocommerce.svg`, `public/images/FedEx-Logo-PNG-Transparent.png` and `public/images/United_Parcel_Service_logo.png` were removed. A grep over the repo (excluding `design/` prose) found no references to them.

## Replaced in place

- `etsy.svg`: was a home-made `<text>` imitation. Now the simple-icons E mark.
- `amazon.svg`: was an Inkscape/Wikimedia copy of the smile wordmark. Now the simple-icons "a + smile" mark, which reads at 16px.
- `shopify.jpg`: see above.

## Using `-mono.svg`

`currentColor` does not inherit into `<img src>`; there it renders black. To tint a mono asset, use a CSS mask (`mask: url(/logos/x-mono.svg) center/contain no-repeat; background-color: currentColor`) or inline the SVG.
