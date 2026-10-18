// One-off: a PHOTOREAL demo product photo for the tutorials that run an AI on the product photo (Video Studio,
// listing creation). The vector demo art in public/demo/*.jpg makes AI video morph the pattern (5/10 on the quality
// check), so these tutorials use a real-looking photo made with the app's image model chain (Nano Banana Pro first,
// lib/ai/models 'image' tier) through lib/ai/videoProduct generateKeyframe.
//
//   npx tsx scripts/tutorials/make-demo-photo.ts [count=3]   → .cache/tutorials/demo-photo/variant-N.jpg
//   npx tsx scripts/tutorials/make-demo-photo.ts --pick N    → public/demo/iznik-bowl-photo.jpg (1600 px JPEG)
//
// GEMINI_API_KEY from .env.local (never printed); the AI usage log goes to the local demo DB (localhost:5544) only.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import sharp from 'sharp';

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true } as any);
for (const k of ['DATABASE_URL', 'DIRECT_URL']) {
  const v = process.env[k];
  if (v && !/@(localhost|127\.0\.0\.1):5544\//.test(v)) throw new Error(`${k} is not the local demo DB (localhost:5544): refusing`);
}
const WORK = path.join(ROOT, '.cache/tutorials/demo-photo');
const OUT = path.join(ROOT, 'public/demo/iznik-bowl-photo.jpg');

const PROMPT = [
  'A real product photograph for an online shop listing, shot on a full-frame camera with a 50 mm lens.',
  'A single hand-painted Iznik-style Turkish ceramic serving bowl, about 20 cm wide, wheel-thrown, glossy white glaze with',
  'cobalt blue tulip and carnation motifs, small red and turquoise accents, a thin blue band on the rim, visible brush',
  'strokes and slight hand-made irregularities. The whole bowl is in frame, seen from slightly above so the painted',
  'inside and the outside wall both show, centred, filling about 60 % of the square frame.',
  'It stands on a plain light oak table against a softly blurred warm off-white wall. Soft natural daylight from a',
  'window on the left, gentle soft shadow, true-to-life colours, crisp focus on the bowl.',
  'Product only: no people, no hands, no other objects, no props, no text, no logos, no watermark, no border.',
].join(' ');

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const pick = process.argv.indexOf('--pick');
  if (pick > 0) {
    const n = Number(process.argv[pick + 1]);
    const src = path.join(WORK, `variant-${n}.jpg`);
    if (!fs.existsSync(src)) throw new Error(`${src} missing`);
    await sharp(src).resize(1600, 1600, { fit: 'cover' }).jpeg({ quality: 86, mozjpeg: true }).toFile(OUT);
    console.log(`[demo-photo] variant ${n} → ${path.relative(ROOT, OUT)}`);
    return;
  }
  const { generateKeyframe } = await import('../../lib/ai/videoProduct');
  const count = Number(process.argv[2] || 3);
  for (let i = 1; i <= count; i++) {
    const img = await generateKeyframe({ userId: 'demo-user-kolayxport', refs: [], prompt: PROMPT, aspectRatio: '1:1' });
    const file = path.join(WORK, `variant-${i}.jpg`);
    await sharp(Buffer.from(img.data, 'base64')).jpeg({ quality: 92 }).toFile(file);
    console.log(`[demo-photo] ${path.relative(ROOT, file)}`);
  }
  fs.writeFileSync(path.join(WORK, 'prompt.txt'), PROMPT + '\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[demo-photo] failed:', e?.message || e); process.exit(1); });
