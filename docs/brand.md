# KolayXport brand system

Version 2 ("Blade"), 2026-10-17. The source files are `public/brand/*` (built by `scripts/brand/build-logo.py`) and the raster exports (built by `scripts/brand/export-assets.mjs`). Both are reproducible, so never edit an exported file by hand.

## 1. Idea

**KolayXport = Kolay Export (kolay ihracat).** The logo comes straight from the name: "kolay" and "port" are calm and solid, and the **X is the hit point**. Its rising stroke is a blade that shoots up and out of the word, in an electric blue-to-cyan gradient: export, speed, done. It also reads as a fast check mark.

The brand line is **"Yurt dışına satışın tek paneli"**. The look is modern and precise: deep ink, clean white, one electric blue, and the blade as the only flourish.

## 2. Logo

All files are in `public/brand/`.

| File | Use |
|---|---|
| `kolayxport-logo.svg` | **Default.** On white or light backgrounds |
| `kolayxport-logo-dark.svg` | On ink, dark photos or dark mode |
| `kolayxport-logo-mono.svg` / `-mono-white.svg` | One colour only: invoices, labels, stamps, embossing, partner pages, on top of the brand blue |
| `kolayxport-symbol.svg` | App icon: the X on an ink rounded tile |
| `kolayxport-symbol-light.svg` | App icon on a white tile |
| `kolayxport-symbol-square.svg` | Square, no rounding: social avatars (platforms crop it themselves) |
| `kolayxport-mark.svg` / `-mark-dark.svg` / `-mark-mono.svg` | The X alone, no tile: small spaces, loaders, watermarks |
| `favicon.svg` / `/favicon.ico` | Browser tab |
| `png/*` | PNG copies for tools that can't take SVG: Canva, slides, marketplace profiles. Logo 1600 px wide, symbol 1024 px, marks 512 px |
| `email/*` | Hosted PNGs for emails (mail clients don't show SVG). Used by `lib/email/layout.ts` |
| `social/*` | X header, Facebook cover, LinkedIn banner, YouTube banner, avatars |
| `/og/default.png`, `/og/<locale>/<type>/<slug>.png` | Link previews. Regenerate with `npm run gtm:og` |

- **Clear space:** keep at least the height of the "k" empty on every side.
- **Minimum size:** symbol 16 px; full logo 96 px wide.
- **Writing the name in text:** always "KolayXport", with a capital K and a capital X. Never "Kolayxport", "KOLAYXPORT" or "Kolay Xport". The logo itself is set lowercase with the big X; that's only for the logo.
- **Don't:** redraw or retype the logo, change the gradient, straighten the blade, add shadows or outlines, rotate it, or put it on a busy photo without an ink or white panel behind it.

## 3. Colour

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0B1220` | Text, dark surfaces, the symbol tile |
| `paper` | `#F7F8FB` | Marketing page background (white is fine too) |
| `kx` (brand blue) | `#2F5BFF` | Links, primary buttons, start of the blade. 5.0:1 on paper, so AA for text |
| `kx-cyan` | `#00C6FF` | End of the blade gradient and highlights on ink. **Never** use it for text on light backgrounds |
| `kx-soft` | `#8FA8FF` | The blue for text on ink |
| `ink-soft` | `#3A465A` | Secondary text (9.4:1) |
| `line` | `rgba(11,18,32,.12)` | Borders and rules |
| `success` / `warning` / `danger` | from `lib/ds/tokens.ts` | Status only, same values as the app |

**The gradient** is `#2F5BFF → #00C6FF` and runs along the blade (bottom-left to top-right). Use it on the logo and as a thin streak on big images (OG cards, banners), nowhere else.

**The app UI keeps its own tokens** (`lib/ds/tokens.ts`, accent `#2563EB`). It is the same hue family as `kx`, so the site and the product feel like one brand.

**Never use marketplace trade dress.** That means no Etsy orange, no Amazon yellow or smile, no eBay four colours and no Trendyol orange (see `design/launch/brand.md`).

## 4. Type

- **Display: Plus Jakarta Sans** (OFL), 800, letter-spacing −0.03em. The logo face. Use it for headlines and big numbers.
- **Text: Instrument Sans** (OFL), 400/500/600. Use it for body copy, UI, buttons and labels.
- **App UI:** keeps Inter.
- **Email:** the system font stack (web fonts don't load reliably in mail clients).

Both fonts have every Turkish glyph (ş ğ ı İ ç ö ü), and both are self-hosted through `next/font` as small subsets (`scripts/brand/subset-fonts.py`).

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
- **Elevation:** paper cards get a 1 px `line` border and no heavy shadows. Screenshots get one soft shadow, `0 30px 60px -30px rgba(11,18,32,.35)`.

## 6. Imagery

1. **Product screenshots come first.** They are real app screens captured by `scripts/gtm/capture-screens.ts` from the seeded demo account, so they contain no customer data. Each one sits in a 20 px-radius frame with a thin ink border, with no fake browser chrome. When a screen needs context, crop it to the relevant panel.
2. **Lifestyle photos are editorial, not stock.** They show real-feeling Turkish workshops, hands, products and parcels in natural light, generated with `scripts/brand/generate-marketing-images.ts` and picked from a contact sheet.
   - They are illustrations. Never pair one with a customer name or quote.
   - They contain no marketplace or carrier logos and no fake app UI.
3. **Icons:** lucide line icons at 1.75 px stroke, in ink or accent. Never use marketplace logos as decoration.
4. **Motif:** the blade streak (a long tapering blue-to-cyan diagonal) on big dark surfaces such as OG cards, banners and video title cards. One per image.

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

## 9. Email

Every email goes out with the branded HTML shell in `lib/email/layout.ts`: logo on top, a white card, one blue button, and the company line in the footer.
- Postmark emails (`sendEmail` in `lib/auth/email.ts`) get it automatically from the text body.
- To brand a new email, pass `renderEmailHtml({ title, text, action: { url, label } })`.
- The logo image is `https://kolayxport.com/brand/email/kolayxport-logo.png`. Use it for email signatures too, at 160 px wide.
