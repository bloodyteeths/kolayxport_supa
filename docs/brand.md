# KolayXport brand system

Version 1, 2026-10-17. The source files are `public/brand/*` (built by `scripts/brand/build-logo.py`) and the raster exports (built by `scripts/brand/export-assets.mjs`). Both are reproducible, so never edit a PNG by hand.

## 1. Idea

**The brand line is "Yurt dışına satışın tek paneli".** The visual language borrows from an export manifest: warm paper, ink, ruled lines, a dashed "stamp" circle, and one ultramarine accent.

**The symbol** is an ink tile with two crossing strokes. The ultramarine stroke that runs over the top turns into an arrow pointing up and to the right: the X in "Xport" leaving for abroad.

## 2. Logo

| File | Use |
|---|---|
| `kolayxport-logo.svg` | Default, on light backgrounds (paper or white) |
| `kolayxport-logo-dark.svg` | On ink or dark photos |
| `kolayxport-logo-mono.svg` | Single colour (`currentColor`): stamps, partner pages, embossing |
| `kolayxport-symbol.svg` / `-dark` / `-mono` | App icon, avatars, small spaces |
| `kolayxport-wordmark.svg` | Wordmark only, where the symbol already appears nearby |
| `favicon.svg` / `favicon.ico` | Browser tab only. A simplified arrow that stays legible at 16 px |
| `social/*` | X header, Facebook cover, LinkedIn banner, YouTube banner, avatars |
| `/og/default.png`, `/og/<locale>/<type>/<slug>.png` | Link previews. Regenerate with `npm run gtm:og` |

- **Clear space:** keep at least half the symbol's height empty on every side.
- **Minimum size:** symbol 16 px; full logo 96 px wide.
- **Wordmark:** it is always "KolayXport", with a capital K and a capital X, and only the X in the accent colour. Never "Kolayxport", "KOLAYXPORT" or "Kolay Xport".
- **Don't:** recolour the symbol, add shadows or gradients, rotate it, or set the logo on a busy photo without an ink or paper panel behind it.

## 3. Colour

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0E1A2B` | Text, dark surfaces, the symbol tile |
| `paper` | `#FAF7F0` | Marketing page background |
| `accent` | `#2B45E0` | Links, primary buttons, the X. Contrast on paper is 6.6:1, so it is AA for any text |
| `accent-soft` (dark mode) | `#8EA0FF` | The accent on ink backgrounds |
| `kraft` | `#C9A57B` | Warm detail only: illustrations, rules, tags. Never use it for text |
| `ink-soft` | `#3A4658` | Secondary text on paper (9.6:1) |
| `line` | `rgba(14,26,43,.12)` | Borders and rules |
| `success` / `warning` / `danger` | from `lib/ds/tokens.ts` | Status only, same values as the app |

**The app UI keeps its own tokens** (`lib/ds/tokens.ts`, accent `#2563EB`). The marketing accent `#2B45E0` is the same hue, slightly deeper, so the site and the product feel like one brand.

**Never use marketplace trade dress.** That means no Etsy orange, no Amazon yellow or smile, no eBay four colours and no Trendyol orange (see `design/launch/brand.md`).

## 4. Type

- **Display: Fraunces** (Google Fonts, OFL), weight 600, `opsz` 96, `SOFT` 100. Use it for headlines and big numbers only.
- **Text: Instrument Sans** (OFL), 400/500/600. Use it for body copy, UI, buttons and labels.
- **App UI:** keeps Inter.

Both fonts have every Turkish glyph (ş ğ ı İ ç ö ü), and both are self-hosted through `next/font`.

Scale (marketing, mobile → desktop):

| Role | Size | Line height |
|---|---|---|
| Display XL (hero H1) | 40 → 72 px | 1.04 |
| Display L (section H2) | 30 → 48 px | 1.1 |
| Display M (H3, cards) | 22 → 28 px | 1.2 |
| Lead | 18 → 21 px | 1.5 |
| Body | 16 → 17 px | 1.6 |
| Small / labels | 13–14 px | 1.4, `uppercase` + `letter-spacing:.12em` for eyebrows |

## 5. Space, radius, elevation

- **Spacing:** a 4 px base. Sections are 72 px apart on mobile and 120 px on desktop. Content max-width is 1200 px, and text measure is at most 68 characters.
- **Radius:** 12 px for cards, 999 px for pills and buttons, 20 px for screenshot frames.
- **Elevation:** paper cards get a 1 px `line` border and no heavy shadows. Screenshots get one soft shadow, `0 30px 60px -30px rgba(14,26,43,.35)`.

## 6. Imagery

1. **Product screenshots come first.** They are real app screens captured by `scripts/gtm/capture-screens.ts` from the seeded demo account, so they contain no customer data. Each one sits in a 20 px-radius frame with a thin ink border, with no fake browser chrome. When a screen needs context, crop it to the relevant panel.
2. **Lifestyle photos are editorial, not stock.** They show real-feeling Turkish workshops, hands, products and parcels in natural light, generated with `scripts/brand/generate-marketing-images.ts` and picked from a contact sheet.
   - They are illustrations. Never pair one with a customer name or quote.
   - They contain no marketplace or carrier logos and no fake app UI.
3. **Icons:** lucide line icons at 1.75 px stroke, in ink or accent. Never use marketplace logos as decoration.
4. **Motifs:** the ruled "manifest" lines, the dashed stamp circle, and a kraft label tag for eyebrow labels. Use them sparingly: one motif per section.

## 7. Voice (Turkish)

- **Choice: "siz", warm and direct.**
  - **Why:** the reader is a business owner trusting us with their shop, their money and their customers' data. "Siz" is what Turkish sellers expect from a paid business tool (Trendyol Satıcı Paneli, banks and accounting tools all use it), and our pricing sits above the integrators, so the tone has to signal seriousness.
  - **Warmth comes from being concrete, not from slang.**
  - **Exception:** ads and social posts may quote sellers in their own words, including "sen". Our own sentences stay "siz".
- **Principles:**
  1. Name the real problem in the seller's words first ("134 ürün, 4 satış"), then show the exact screen that helps.
  2. Use concrete verbs: *bağlayın, düzenleyin, gönderin, yazdırın*. Avoid "çözüm", "inovatif", "devrim" and "tek tık" (unless it really is one click).
  3. Use numbers only when they are true and sourced.
  4. Say what we don't do. ("Hepsiburada henüz yok.")
  5. Keep the terms sellers use: ilan/listing, etiket (tag), desi, ETGB, e-Arşiv, kargo barem.
- **Forbidden:** "en iyi", "tek", "#1", "garantili satış", "sınırlı kontenjan" (unless it's the real founding cap), invented customer numbers, invented reviews.

| Do | Don't |
|---|---|
| "İlanlarınızı yapay zekâyla İngilizce yeniden yazın; değişiklikler siz 'Gönder' demeden Etsy'ye gitmez." | "Yapay zekâ ile satışlarınızı 10 kat artırın!" |
| "FedEx ve UPS etiketini kendi hesabınızla, panelden basın." | "Tüm kargo firmalarıyla entegre!" |
| "İlk 20 abone için ömür boyu %40 indirim." (with the live counter) | "Son 3 yer kaldı!" (unless the counter says so) |

## 8. English

English uses the same principles in plain, friendly English. The product name is "KolayXport", and "Türkiye" is used instead of "Turkey" in our own copy.
