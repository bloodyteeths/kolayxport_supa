/**
 * Lifestyle / editorial images for the marketing site and ads (GTM Phase 3), via the Gemini image model.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/brand/generate-marketing-images.ts [round] [shot-id ...]
 *
 * Writes PNGs + contact-sheet.html to docs/gtm/brand/images/<round>/ for review; approved picks are
 * converted to AVIF/WebP into public/marketing/ by scripts/brand/export-assets (later step).
 *
 * Honesty rules (docs/brand.md): these are illustrations, never presented as real customers;
 * no carrier/marketplace logos; no fake app UI on screens (real screenshots are composited later).
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const VARIANTS = Number(process.env.VARIANTS || 2);

const STYLE = `Photorealistic editorial photograph, natural window light, warm and honest, shot on a 35mm lens
at f/2.8, shallow depth of field, true-to-life colours, slight film grain. Setting is clearly in Turkey
(small workshop or home studio, Turkish details used subtly: tea glass, tile, textiles), modern and tidy, not touristy.
People look like real small-business owners in Turkey, natural expressions, not posing for the camera, no stock-photo smiles.
No text, no logos, no brand names, no watermarks, no readable labels. Any laptop or phone screen is either turned away,
out of focus, or shows a plain blank light-grey screen (a real product screenshot will be placed there later).
Leave calm negative space on one side for headline text.`;

type Shot = { prompt: string; aspect: '16:9' | '4:5' | '1:1' | '9:16'; use: string };

export const SHOTS: Record<string, Shot> = {
  'hero-packing': {
    aspect: '16:9',
    use: 'Home hero (export story)',
    prompt: 'A woman in her 30s in a bright home atelier carefully wraps a handmade ceramic bowl in kraft paper and places it into a shipping box; several sealed parcels with blank white address labels are stacked beside her, ready to go abroad. A laptop sits open on the table, screen out of focus.',
  },
  'hero-jewelry': {
    aspect: '16:9',
    use: 'Etsy satıcısı landing hero',
    prompt: 'Close-up of a silversmith\'s hands finishing a delicate filigree (telkari) silver necklace at a wooden workbench, small tools around, a finished piece on a linen cloth, soft morning light.',
  },
  'product-photo': {
    aspect: '16:9',
    use: 'AI ürün fotoğrafı / listing optimisation section',
    prompt: 'A young man photographs a folded handwoven Turkish peshtemal towel on a simple tabletop setup with a white sweep and a softbox, using his phone on a small tripod; a few other textiles neatly folded nearby.',
  },
  'parcels-ready': {
    aspect: '4:5',
    use: 'Kargo etiketi / micro-export section, Instagram',
    prompt: 'Top-down view of a worktable with six small kraft parcels of different sizes, each with a plain blank white label, a roll of tape, a small scale, and a glass of Turkish tea; hands placing the last parcel in line.',
  },
  'research-cafe': {
    aspect: '16:9',
    use: 'Araştırma & arbitraj section',
    prompt: 'A woman in her late 20s sits at a small café table in Istanbul with a laptop (screen turned away from the camera) and a notebook with hand-drawn price comparisons and arrows, thinking, a simit and tea beside her.',
  },
  'textile-workshop': {
    aspect: '16:9',
    use: 'Trendyol\'dan dünyaya landing hero',
    prompt: 'A small family textile workshop in Turkey: shelves of neatly folded towels and bathrobes, a man in his 40s checks a printed order list while a younger colleague packs items into boxes; daylight from high windows.',
  },
  'founder-desk': {
    aspect: '4:5',
    use: 'Social / about section (illustrative)',
    prompt: 'A small-business owner at a tidy desk at dusk, looking at a phone with a calm satisfied expression after a long day; behind her a shelf of handmade candles and ceramics ready for shipping.',
  },
  'leather-goods': {
    aspect: '1:1',
    use: 'Ads square, eBay/Etsy creatives',
    prompt: 'A leather craftsman\'s hands stitching a handmade leather wallet, natural leather offcuts and a finished bag on the bench, warm light.',
  },
  'story-vertical': {
    aspect: '9:16',
    use: 'Reels/Stories background',
    prompt: 'Vertical shot: a woman carries a stack of three parcels out of her small studio door into a sunlit cobbled street in an Aegean town, seen from behind and slightly to the side.',
  },
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const [round = 'round1', ...only] = process.argv.slice(2);
  const outDir = path.join(process.cwd(), 'docs/gtm/brand/images', round);
  fs.mkdirSync(outDir, { recursive: true });
  const ai = new GoogleGenAI({ apiKey });
  const ids = only.length ? only : Object.keys(SHOTS);
  const done: { id: string; file: string }[] = [];

  for (const id of ids) {
    const shot = SHOTS[id];
    if (!shot) { console.error('unknown shot', id); continue; }
    for (let v = 1; v <= VARIANTS; v++) {
      try {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: `${shot.prompt}\n\n${STYLE}` }] }],
          config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: shot.aspect, imageSize: '2K' } } as any,
        });
        const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
        if (!part?.inlineData?.data) throw new Error('no image in response');
        const file = `${id}-${v}.png`;
        fs.writeFileSync(path.join(outDir, file), Buffer.from(part.inlineData.data, 'base64'));
        done.push({ id, file });
        console.log('ok', file);
      } catch (err) {
        console.error('failed', id, v, String((err as Error).message).slice(0, 200));
      }
    }
  }

  const cards = done.map((d) => `<figure><img src="${d.file}" alt="${d.id}" loading="lazy"><figcaption><b>${d.file}</b> · ${SHOTS[d.id].aspect} · ${SHOTS[d.id].use}</figcaption></figure>`).join('\n');
  fs.writeFileSync(path.join(outDir, 'contact-sheet.html'), `<!doctype html><meta charset="utf-8"><title>KolayXport images — ${round}</title>
<style>body{font:14px system-ui;margin:24px;background:#f8fafc}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}img{width:100%;border-radius:8px}figcaption{color:#475569;margin-top:8px}</style>
<h1>KolayXport marketing images — ${round}</h1><p>AI illustrations (${MODEL}). Not real customers.</p><main>${cards}</main>`);
}

main().catch((e) => { console.error(e); process.exit(1); });
