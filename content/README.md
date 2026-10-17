# Marketing content (edit here, no code needed)

Every public long-form page is one Markdown file. Short UI strings (buttons, nav) live in `messages/tr.json` / `messages/en.json` under `marketing.*`.

```
content/
  tr/                     Turkish (primary)          → kolayxport.com/...
  en/                     English                    → kolayxport.com/en/...
    cases/<slug>.md         use-case landing pages    → /cozumler/<slug>
    integrations/<slug>.md  one page per integration  → /entegrasyonlar/<slug>
    compare/<slug>.md       KolayXport vs X           → /karsilastirma/<slug>
    guides/<slug>.md        how-to guides             → /nasil-kullanirim/<slug>
    blog/<slug>.md          blog posts                → /blog/<slug>
    legal/<slug>.md         legal texts               → /<slug>  (e.g. /kvkk-aydinlatma-metni)
  testimonials/*.json     real customer quotes (only with written consent)
```

The file name is the URL slug: lowercase, `a-z0-9-`, Turkish characters transliterated (ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c).
An English file uses the **same slug** as its Turkish twin.

## Frontmatter (the block between `---` lines at the top)

Common to all types:

```yaml
title: "Max 60 characters, shown in Google and the browser tab"
description: "Max 155 characters, shown under the title in Google"
h1: "The page's one big headline"
keyword: "primary search phrase this page targets"
updated: 2026-10-17
inventoryRefs: [ai-listing-copy, research-keywords]   # rows in docs/gtm/feature-inventory.md that prove every claim
draft: false            # true = page is not published
```

### cases (use-case landing pages, also used as ad landing pages)
```yaml
eyebrow: "Etsy satıcıları için"
subtitle: "One or two sentences under the H1"
image: hero-jewelry               # image slot id (public/marketing/<id>.webp); omit to show a product screenshot
screenshot: etsy-listings          # product screenshot id (public/marketing/screens/<id>.webp)
pains:                             # the problem, in sellers' own words (docs/gtm/pain-points.md)
  - quote: "134 ürün, 4 satış — bu normal mi?"
    source: "Etsy Community TR"
features:                          # 3–6, each must map to an inventoryRefs row
  - title: "..."
    text: "..."
    ref: ai-listing-copy
steps:                             # "how it works", exactly 3
  - "..."
faq:
  - q: "..."
    a: "..."
cta: signup                        # signup | pricing | contact
```

### integrations
```yaml
name: "Etsy"
kind: marketplace                  # marketplace | carrier | accounting | tool
status: production                 # production | beta | partial
setupMinutes: 3
connect: "OAuth — Etsy hesabınızla giriş yapıp izin verirsiniz"
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: yes                    # yes | partial | no
    note: "15 dakikada bir otomatik"
    ref: etsy-orders
faq: [...]
```

### compare
```yaml
competitor: "Sentos"
lastVerified: 2026-10-17
sources: ["https://..."]
rows:
  - feature: "Etsy ilan düzenleme"
    us: "yes"          # yes | partial | no | text
    them: "no"
    note: "..."
```

### guides (how-to library, HowTo schema)
```yaml
duration: "PT3M"               # ISO 8601 time to complete
video: { youtubeId: "", file: "connect-etsy" }   # filled by scripts/tutorials
steps:
  - name: "Ayarlar › Bağlantılar'ı açın"
    text: "..."
    image: guides/connect-etsy/01.webp
```

### blog
```yaml
author: "KolayXport Ekibi"
date: 2026-10-17
tags: [etsy, seo]
image: hero-packing
```

### legal
```yaml
effective: 2026-10-17
lawyerReviewed: false     # shows a "taslak" notice until a lawyer has reviewed it
```

## Rules
- **Every product claim must point to an `inventoryRefs` row.** `npm run gtm:check-claims` fails the build of the content check if a ref is missing, or if it points to a feature marked stub/none.
- No invented customers, numbers, ratings or "limited spots". The founding-member counter is live data; never write a number.
- Tone: **siz**, warm and concrete (see docs/brand.md).
- Quote sellers only as they wrote publicly, with the source.
