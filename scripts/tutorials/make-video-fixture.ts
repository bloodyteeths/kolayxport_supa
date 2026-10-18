// One-off: make the REAL Video Studio sample for the "ai-urun-videosu" tutorial, through the same server code the
// app's POST /api/ai/video runs (pages/api/ai/video/index.ts launchTake → prepareAndStart → refresh → runQa), with
// the demo listing's photo. The recording then replays this result from fixtures (scripts/tutorials/fixtures/
// video-studio), so no AI call happens while recording.
//
//   npx tsx scripts/tutorials/make-video-fixture.ts            (refuses when sample.mp4 exists; --force to redo)
//
// Reads GEMINI_API_KEY from .env.local (never printed). The database it may touch (AI usage log rows) must be the
// local demo DB on localhost:5544: anything else is refused before any app module is loaded.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true } as any);
for (const k of ['DATABASE_URL', 'DIRECT_URL']) {
  const v = process.env[k];
  if (v && !/@(localhost|127\.0\.0\.1):5544\//.test(v)) throw new Error(`${k} is not the local demo DB (localhost:5544): refusing`);
}
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing in .env.local');
// Vertex is not configured locally: the Gemini API Veo route (same lib/ai/video code, provider "gemini").
delete process.env.VERTEX_PROJECT;
delete process.env.VERTEX_CREDENTIALS_FILE;

const OUT = path.join(ROOT, 'scripts/tutorials/fixtures/video-studio');
const WORK = path.join(ROOT, '.cache/tutorials/video-fixture');
process.env.AI_VIDEO_UPLOAD_DIR = WORK; // where lib/ai/video saves the mp4 (before it is copied to the fixture)

const USER = 'demo-user-kolayxport';
const TITLE = 'Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Pattern, Turkish Pottery Serving Bowl, 8 Inch';
// Photoreal demo photo (scripts/tutorials/make-demo-photo.ts): the vector demo art scored 5/10 match, 4/10 realism.
const PHOTO_FILE = 'public/demo/iznik-bowl-photo.jpg';
const PHOTO_REF = '{{base}}/demo/iznik-bowl-photo.jpg'; // what the studio sends as the ref (listing-photos fixture)

const log = (...a: unknown[]) => console.log('[video-fixture]', ...a);

async function main() {
  const sample = path.join(OUT, 'sample.mp4');
  if (fs.existsSync(sample) && !process.argv.includes('--force')) throw new Error(`${path.relative(ROOT, sample)} exists (use --force to make a new one)`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });

  const { analyzePhotos, checkVideo, extendFrame } = await import('../../lib/ai/videoProduct');
  const { DEFAULT_DIRECTION, normalizeDirection, directVideo, negativePrompt } = await import('../../lib/ai/videoDirector');
  const { VIDEO_TARGET_PROFILES, formatForPhoto, generationAspect } = await import('../../lib/ai/videoTargets');
  const { fitToAspect } = await import('../../lib/ai/videoSources');
  const { writeVideoPrompt } = await import('../../lib/ai/videoPromptWriter');
  const { startVideo, pollVideo, saveVideo, finishInPlace, videoModel, activeVideoProvider } = await import('../../lib/ai/video');
  const { videoCredits } = await import('../../lib/billing/aiCredits');
  const { normalizeProfile } = await import('../../lib/ai/videoShots');

  const photo = { data: fs.readFileSync(path.join(ROOT, PHOTO_FILE)).toString('base64'), mimeType: 'image/jpeg' };
  const products = [photo];
  const t0 = Date.now();

  // 1. POST /api/ai/video/analyze (the studio calls it as soon as the listing's photos are in).
  log('analyzing the photo…');
  const analysis = await analyzePhotos(USER, products, { title: TITLE, locale: 'tr' });
  const analyzeJson = {
    photos: analysis.photos.map((p) => ({ ref: PHOTO_REF, ...p })),
    start: analysis.start === null ? null : PHOTO_REF,
    end: analysis.end === null ? null : PHOTO_REF,
    product: analysis.product,
    shots: analysis.shots,
    scenes: analysis.scenes,
  };
  fs.writeFileSync(path.join(OUT, 'analyze.json'), JSON.stringify(analyzeJson, null, 2) + '\n');
  log(`shots: ${analysis.shots.map((s) => s.label).join(' | ')}`);

  // 2. The studio's defaults for an Etsy listing (VideoStudio.tsx): target etsy, the format closest to the photo,
  //    8 s 1080p, no sound, "Standart" quality, the first suggested shot, the setting kept from the photo.
  const profileEtsy = VIDEO_TARGET_PROFILES.etsy;
  const format = formatForPhoto(profileEtsy, 1); // the demo photo is square
  const aspectRatio = generationAspect(format, false);
  const shot = analysis.shots[0];
  const kind = analysis.product?.kind === 'worn' ? 'worn' : 'object';
  const anyPerson = analysis.photos.some((p) => p.person);
  const direction: any = {
    ...normalizeDirection({
      ...DEFAULT_DIRECTION, audio: profileEtsy.audio, target: 'etsy', format, product: TITLE.slice(0, 160),
      productKind: kind, profile: analysis.product?.profile, person: anyPerson,
      ...(shot ? { preset: 'custom', shotText: shot.action, showsBack: Boolean(shot.showsBack) } : {}),
    }),
    locale: 'tr', genAspect: aspectRatio, variants: 1, lock: true,
  };
  // 3–4. prepareAndStart + refresh(): anchor frame, the AI director's prompt, Veo, save, finish (Etsy: square, mute,
  //      light grain). `changes` = the follow-ups so far (English), exactly as launchTake passes them.
  const durationSec = 8;
  const resolution = '1080p';
  const quality = 'fast' as const;
  const first = await fitToAspect(photo, aspectRatio, direction.format, { extend: (m, a) => extendFrame(USER, m, a) });
  fs.writeFileSync(path.join(WORK, 'first-frame.jpg'), Buffer.from(first.data, 'base64'));
  const provider = activeVideoProvider();

  async function take(id: string, dir: any, changes: string[]) {
    let prompt = directVideo(dir, changes);
    let negative = negativePrompt(dir);
    const written = await writeVideoPrompt(USER, { first, last: null, products, direction: dir, changes, durationSec });
    if (written) {
      prompt = written.prompt;
      negative = Array.from(new Set([...negative.split(', '), ...written.negative])).join(', ');
    }
    log(`${id}: starting Veo (${provider}, ${videoModel(quality, provider)})…`);
    const t1 = Date.now();
    const started = await startVideo({ mode: 'image', prompt, negativePrompt: negative, image: first, aspectRatio, durationSec, resolution, quality, variants: 1, seed: null, audio: false });
    let r: Awaited<ReturnType<typeof pollVideo>> = { done: false };
    const deadline = Date.now() + 20 * 60_000;
    while (!r.done) {
      if (Date.now() > deadline) throw new Error('Veo timed out');
      await new Promise((res) => setTimeout(res, 10_000));
      r = await pollVideo(started);
    }
    if (!r.ok) throw new Error(`Veo refused or failed: ${r.errorKey} — ${r.detail}`);
    const file = await saveVideo(USER, id, r.videos[0]);
    await finishInPlace(file, { mute: dir.audio === 'none', format: dir.format, grain: dir.grain !== false });
    log(`${id}: video ready (${Math.round((Date.now() - t1) / 1000)} s), quality check…`);
    // runQa(): two looks against the photos, the stricter wins.
    const qa = await checkVideo({ userId: USER, file, refs: products, locale: 'tr', person: false, profile: normalizeProfile(dir.profile, dir.productKind) });
    log(`${id}: match ${qa.match ?? '-'} / realism ${qa.realism ?? '-'} (${qa.status})`);
    return { id, file, qa, prompt, negative, reading: written?.reading ?? null, promptBy: written ? 'ai' : 'rules', model: started.model, provider: started.provider, changes, direction: dir };
  }
  const qaScore = (q: any) => (q.match ?? 0) * 2 + (q.realism ?? 0);

  const takes = [await take('vtutorialsample0000000001', direction, [])];
  // One automatic fix, the way runQa does it (production: free, below 9/10): a safer shot when the product changed
  // badly (≤ 4/10), else the check's own directions as the follow-up. Here only when below the 8/10 target.
  const q0 = takes[0].qa;
  if (q0.status === 'done' && ((q0.match ?? 10) < 8 || (q0.realism ?? 10) < 8)) {
    const fixes = [...(q0.diffs ?? []), ...(q0.issues ?? [])].map((x: any) => x.fix).filter(Boolean).slice(0, 5);
    const safer = (q0.match ?? 10) <= 4;
    const instruction = safer ? 'Keep the product perfectly still and exactly as in the photos; only the camera moves' : fixes.join('. ').slice(0, 400);
    const dir2 = safer ? { ...direction, preset: 'hero', shotText: undefined, showsBack: false, autoFixOf: takes[0].id } : { ...direction, autoFixOf: takes[0].id };
    log(`auto-fix (${safer ? 'safer shot' : 'fix'}): ${instruction}`);
    takes.push({ ...(await take('vtutorialsample0000000002', dir2, [instruction])), instruction } as any);
  }
  const best = takes.reduce((b, t) => (t.qa.status === 'done' && qaScore(t.qa) > qaScore(b.qa) ? t : b), takes[0]);

  // Fixture video: 1080p, re-encoded small enough for git (CRF 26, no sound — Etsy removes it anyway).
  const { execFileSync } = await import('child_process');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', best.file, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sample]);
  const genSec = Math.round((Date.now() - t0) / 1000);
  log(`sample.mp4: ${(fs.statSync(sample).size / 1e6).toFixed(1)} MB (take ${best.id})`);

  const credits = videoCredits({ quality, resolution, durationSec, variants: 1 });
  fs.writeFileSync(path.join(OUT, 'generation.json'), JSON.stringify({
    madeAt: new Date().toISOString(),
    photo: PHOTO_FILE,
    title: TITLE,
    provider: best.provider,
    model: best.model,
    aspectRatio, format, durationSec, resolution, quality,
    shot: shot ?? null,
    credits,
    seconds: genSec,
    chosen: best.id,
    takes: takes.map((t: any) => ({ id: t.id, instruction: t.instruction ?? null, promptBy: t.promptBy, reading: t.reading, prompt: t.prompt, negativePrompt: t.negative, qa: t.qa })),
    direction: { ...best.direction, promptBy: best.promptBy, reading: best.reading || undefined },
    qa: best.qa,
  }, null, 2) + '\n');
  writeJobFixtures({ ...best, credits, format, durationSec, resolution, quality });
  log(`done: match ${best.qa.match ?? '-'} / realism ${best.qa.realism ?? '-'}`);
}

/** The job as GET/POST /api/ai/video return it (pages/api/ai/video/index.ts viewJob): preparing → running → done. */
function writeJobFixtures(b: any) {
  const id = 'vtutorialsample0000000001'; // one id across the replay (the studio polls the id the POST returned)
  const job = (status: string, createdAt: string) => ({
    id, parentId: null, groupId: id, variantIndex: 0, status, mode: 'image', instruction: null,
    aspectRatio: b.format, durationSec: b.durationSec, resolution: b.resolution, quality: b.quality, seed: null,
    model: status === 'preparing' ? 'pending' : b.model, provider: status === 'preparing' ? 'pending' : b.provider,
    errorKey: null, favorite: false, listingRef: 'etsy:1790001234:48291736', title: TITLE,
    direction: { ...b.direction, autoFixOf: undefined }, sourceUrl: PHOTO_REF, endUrl: null, referenceUrls: [PHOTO_REF], credits: b.credits,
    qa: status === 'done' ? (({ clean, ...q }: any) => q)(b.qa) : null, published: null, createdAt,
    url: status === 'done' ? `/api/ai/video/file?id=${id}` : null,
  });
  const w = (f: string, v: unknown) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(v, null, 2) + '\n');
  w('job-start.json', { job: job('preparing', '{{ago:1s}}'), credits: b.credits });
  w('poll-running.json', { jobs: [job('running', '{{ago:8s}}')] });
  w('poll-done.json', { jobs: [job('done', '{{ago:14s}}')] });
  w('listing-photos.json', { photos: [{ id: '6100000000', src: PHOTO_REF, fullSrc: PHOTO_REF }] });
}

main().then(() => process.exit(0)).catch((e) => { console.error('[video-fixture] failed:', e?.message || e); process.exit(1); });
