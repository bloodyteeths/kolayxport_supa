# Tutorial videos: "Nasıl Kullanılır" pipeline

One YAML file per tutorial in `tutorials/`. A single command turns it into:

| Output | Where | Used for |
|---|---|---|
| 16:9 1080p MP4 with intro and outro | `public/media/tutorials/<slug>.mp4` | YouTube, embedded on the site |
| 9:16 MP4 with burned-in Turkish captions | `public/media/tutorials/<slug>-vertical.mp4` | Reels, Shorts, TikTok |
| Turkish subtitles | `public/media/tutorials/<slug>.tr.vtt` | YouTube captions, site player |
| Poster frame | `public/media/tutorials/<slug>.jpg` | YouTube thumbnail base, site poster |
| YouTube title, description, chapters and tags | `public/media/tutorials/<slug>.youtube.txt` | Copy-paste into YouTube Studio |
| Step screenshots | `public/media/guides/<slug>/NN.webp` | The written guide |
| The written guide page | `content/tr/guides/<slug>.md` → `/nasil-kullanirim/<slug>` | Site + HowTo schema |

The video files are **not** committed to git (they're big). Upload them to YouTube and paste the video id into the guide's frontmatter (`video.youtubeId`). The site then embeds the video. Step screenshots and guide pages **are** committed.

## When the UI changes

Re-run the pipeline. Nobody re-records by hand.

```bash
# 1. the app must be running locally with the seeded demo account
npx tsx scripts/demo/seed-demo-account.ts     # once (local DB only)
npm run dev                                    # or: npx next dev -p 3100
# 2. render
export GEMINI_API_KEY=...        # voice-over (Gemini TTS)
export DEMO_PASSWORD=...         # see scripts/demo/README.md
export TUTORIAL_BASE_URL=http://localhost:3100
npm run tutorials -- all                       # or a single slug
npm run tutorials -- etsy-baglama --only=narrate,metadata   # text-only change
```

- **Voice:** Gemini TTS model `gemini-2.5-flash-preview-tts`, voice **Kore**. Keep one voice for every video, and change it only with a full re-render (`TTS_VOICE`).
- **Cache:** narration is cached per line, so editing one sentence re-voices only that sentence.

## Writing a tutorial (`tutorials/<slug>.yaml`)

```yaml
slug: etsy-baglama                 # also the URL: /nasil-kullanirim/etsy-baglama
order: 1                           # position in the library
title: "Etsy mağazanızı bağlayın"
description: "Etsy mağazanızı KolayXport'a 3 dakikada bağlayın; ilanlarınız ve siparişleriniz panele gelsin."
keyword: "etsy entegrasyonu nasıl yapılır"
inventoryRefs: [settings-connections, order-sync-etsy]   # docs/gtm/feature-inventory.md rows
tags: [etsy, etsy entegrasyonu]
startUrl: /ayarlar
steps:
  - say: "Merhaba! Bu videoda Etsy mağazanızı KolayXport'a nasıl bağlayacağınızı göstereceğiz."
  - title: "Ayarlar › Bağlantılar'ı açın"          # titled steps become guide steps + YouTube chapters
    say: "Önce Ayarlar sayfasında Bağlantılar bölümünü açın."
    do:
      - click: { role: tab, name: "Bağlantılar" }
    zoom: { text: "Etsy", scale: 1.6 }
```

**Actions (`do`):**
- `goto: /path`
- `click`, `hover`, `waitFor`: take a selector.
- `fill`: a selector plus `value`.
- `press: Enter`
- `scroll: 600`
- `wait: 1500`

**Selectors:** `{ role, name }`, `{ text }`, `{ label }`, `{ placeholder }`, `{ testid }` or `{ selector: "css" }`. Prefer role and text: they survive redesigns.

**Narration rules:**
- Short spoken Turkish sentences, addressing the viewer as "siz".
- One idea per step.
- 60–120 seconds in total.
- Never promise what the inventory doesn't support.
- Never show real customer data. Use the demo account only.
