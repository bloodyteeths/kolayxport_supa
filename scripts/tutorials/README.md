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
- **Quota:** the free Gemini tier allows about **10 TTS requests per day**. Missing lines are therefore voiced in
  batches (several lines in one request, split back at the pauses; `TTS_BATCH_SEC`, default 180 s of speech per
  request; `TTS_BATCH=0` = one request per line). `npm run tutorials -- all` batches across all tutorials. When the
  daily quota is used up the run stops with the reset time; cached lines are kept, just re-run later.
- **Listen-check:** `node scripts/tutorials/verify-voice.mjs all` transcribes every line (gemini-2.5-flash) and
  flags lines whose words differ from the script, e.g. when the TTS read its instruction aloud. Lines that are much
  longer than their text are also retried automatically while voicing.
- **Preview voice:** `TTS_ENGINE=say` voices with the macOS Turkish voice (Yelda), no quota, cached separately.
  Use it to check timing and visuals; never publish a preview-voice video. Switch back by running without it.

### Other flags

| Flag | Effect |
|---|---|
| `--seed` | Re-seed the local demo account before each recording (see `reseed:` below). |
| `TUTORIAL_DRY=1` with `--only=record` | Run every step with a 1 s hold to check selectors fast. Writes only `.cache/tutorials/<slug>/dry-run.webm`. |

When a step fails, the recorder saves `.cache/tutorials/<slug>/failed-step.png`.

The vertical cut follows the action: for each step it shows a 1280×1080 window of the recording centred on where
the cursor ended up, so text stays readable on a phone. Captions sit under it.

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

**Top-level keys besides the ones above:**
- `ready: <selector>`: wait for this before the video starts. App pages render client-side under `next dev`, so
  always set it to something that only exists once the data is on screen.
- `settleMs: 2500`: extra wait after `ready`.
- `reseed: true`: the tutorial saves drafts (AI title, bulk edits…), so the demo account is re-seeded before
  recording; otherwise a second recording would start from a different screen.
- `mocks:` browser-side fixtures, see below.
- `allowHosts: [host]`: external hosts the page may load (everything else is blocked, see below).
- `guide:` on a step: text for the written guide instead of the narration.

**Actions (`do`):**
- `goto: /path`
- `click`, `hover`, `waitFor`: take a selector. `click` also takes `force: true`.
- `check`: a selector; for row checkboxes that only show on hover (moves there, clicks without waiting).
- `scrollTo`: a selector (plus optional `block: start|center`); scrolls it into view without clicking.
- `fill`: a selector plus `value` (typed visibly).
- `upload`: a file input selector plus `file` (path from the repo root), e.g. a demo product photo.
- `press: Enter` / `press: Escape`
- `scroll: 600`
- `blur: true` (drop the focus ring)
- `wait: 1500`

**Zoom (`zoom:`):** a selector plus `scale`. The page is scaled so that the element stays fully on screen (an
element near an edge is pulled inwards). The next step zooms back out first.

**Selectors:** `{ role, name }` (add `exact: true` for an exact name), `{ text }`, `{ label }`, `{ placeholder }`,
`{ testid }` or `{ selector: "css" }` (Playwright selectors such as `tr:has-text('…')` and `>> nth=-1` work).
Prefer role, testid and text: they survive redesigns. Check new steps with a dry run before voicing.

## Mocks (browser-side fixtures)

Some screens call our own API routes that in turn call a marketplace or Gemini live: the Etsy listing editor,
the inbox, the AI buttons. The demo account only has fake tokens, so during the recording the **browser's** request
is answered with a synthetic JSON fixture (Playwright `page.route`). Nothing on the server changes.

```yaml
mocks:
  - use: etsy-editor          # a set: scripts/tutorials/fixtures/etsy-editor/mocks.yaml
  - url: "**/api/ai/etsy**"   # or a single rule
    body: { action: suggest_tags }
    fixture: etsy-editor/ai-suggest-tags.json
```

A rule has a `url` (Playwright glob, or a regex in code) and optional `method`, `query` (every listed query param
must match) and `body` (top-level JSON fields of the request body must match). It answers with one of:
`fixture` (JSON file under `fixtures/`, or relative to the set's folder), `sequence` (a list of fixture files
answered in turn, the last one repeating; e.g. a job polled as running, then done), `capture: true` next to `fixture`
(record the real answer of our own local server once with `TUTORIAL_CAPTURE=1`, replay it afterwards), `json` (inline), `file`
(serve a local file, `{path}` = request path), `empty: true` (e.g. 204), `merge` (let the request reach our
server and deep-merge this object into its JSON answer; e.g. `etgb-on` switches ETGB on in the settings answer
without writing to the database) or `passthrough: true`. Rules are tried in order; first match wins; no match
lets the request through. Fixture strings may use `{{base}}` (app URL), `{{now}}`, `{{ago:35m}}` (ISO time),
`"{{unix-ago:3d}}"` (epoch seconds) and `"{{base64:path/to/file}}"` (file contents, e.g. a fake AI image).

| Set | For |
|---|---|
| `etsy-editor` | Listing editor reads (listing, sections, shipping, taxonomy, inventory, market search) and the AI title/tag answers. Also stops the 500 on shop sections in the Etsy grid. |
| `etsy-bulk-ai` | Bulk editor "AI ile iyileştir" answer for the three towel listings. |
| `ai-image` | "Fotoğraf oluştur" → a synthetic scene made from the demo renders. |
| `inbox` | Conversation list, threads, order context and the AI reply draft. |
| `etgb-on` | ETGB switched on with a made-up broker address. |
| `demo-cdn` | Price-gap product images on the fake `demo-cdn.kolayxport.test` host. |
| `etsy-create` | New Etsy listing: real AI answers (title, tags, description, AI photo) captured once from our own server with `TUTORIAL_CAPTURE=1 TUTORIAL_DRY=1 node scripts/tutorials/record.mjs etsy-ilan-olusturma`, replayed afterwards (`capture: true` rules). |
| `video-studio` | Video Studio: listing photo, photo analysis, the job (preparing → running → done + quality check) and the mp4. A **real** Video Studio result made once with `npx tsx scripts/tutorials/make-video-fixture.ts` (Veo via `lib/ai/video`, billed `GEMINI_API_KEY`; `generation.json` records model, prompt and QA). Follow-ups, edits and publishing are refused while recording. |

**Safety net (always on):** every request to a host other than the app, `localhost` and Google Fonts is aborted
(marketplaces, carriers, analytics); the recorder prints the blocked hosts. Live pulls and sends are stubbed too:
order sync, finance refresh, price-gap refresh, draft sends to any marketplace, ETGB sends, label purchases,
message replies, every Etsy / eBay write through `/api/clawd/etsy` and `/api/clawd/ebay`, and Video Studio publishing. Fixture data must stay synthetic.

**Narration rules:**
- Short spoken Turkish sentences, addressing the viewer as "siz".
- One idea per step.
- 60–120 seconds in total.
- Never promise what the inventory doesn't support.
- Never show real customer data. Use the demo account only.
