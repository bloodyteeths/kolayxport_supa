/**
 * Logo concept exploration with the Gemini image model (GTM Phase 2).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/brand/generate-logo-concepts.ts [round] [direction-id ...]
 *
 * Writes PNGs + contact-sheet.html to docs/gtm/brand/concepts/<round>/. The images are
 * concept sketches only: the final logo is redrawn by hand as SVG (docs/brand.md).
 * The key is read from the environment and never written anywhere.
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const VARIANTS = Number(process.env.VARIANTS || 2);

const BRIEF = `Brand: "KolayXport" (Turkish "kolay" = easy, "X" = export / cross-border).
Product: a software dashboard that helps small Turkish online sellers sell abroad on Etsy, eBay and Amazon:
AI-written English listings, market research, international shipping labels and export paperwork.
Personality: trustworthy, capable, warm, modern; not a logistics company, not a bank, not a toy.
Must work tiny (16px favicon) and in one colour. Flat vector style, solid shapes, no gradients,
no 3D, no shadows, no mockups, no photo, no text other than what is asked. Plain white background,
logo centered with generous margin.`;

export const DIRECTIONS: Record<string, string> = {
  'x-arrows': 'A symbol where the letter X is built from two strokes, one of which becomes an arrow pointing up and to the right (going outward / abroad). Pair it with the word "KolayXport" in a clean geometric sans-serif, the X slightly emphasised.',
  'kx-monogram': 'A compact monogram fusing a capital K and a capital X into one mark (they share the diagonal strokes), inside a rounded square app-icon shape.',
  'parcel-x': 'A symbol of a simple parcel box seen from above whose tape lines form an X, with one corner flap opening outward like an arrow. Friendly, rounded corners.',
  'routes-globe': 'A symbol of two crossing curved routes (like flight paths) forming an X over a minimal partial globe arc. Very simple, 3 shapes maximum.',
  'bridge-out': 'An abstract symbol suggesting a bridge from Turkey to the world: a single suspension-bridge curve that ends in an upward arrow. Minimal line-art made of thick strokes.',
  'spark-x': 'A rounded, friendly X symbol with a small four-point spark/star at its top-right (hinting at AI), inside a circle.',
  'stamp': 'A circular postage/customs-stamp style badge with the letters "KX" in the middle and a subtle perforated edge; modern and minimal, not vintage.',
  'k-bar-x': 'A minimal geometric mark: a vertical bar plus two diagonal strokes forming a K, where the lower diagonal extends past the bar to also form an X. Bold, monoline.',
};

const PALETTES = [
  'Colours: deep ink navy (#0F172A) and one bright accent blue (#2563EB).',
  'Colours: deep ink navy (#0F172A) and a warm Turkish-red accent (#E11D48).',
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const [round = 'round1', ...only] = process.argv.slice(2);
  const outDir = path.join(process.cwd(), 'docs/gtm/brand/concepts', round);
  fs.mkdirSync(outDir, { recursive: true });
  const ai = new GoogleGenAI({ apiKey });

  const ids = only.length ? only : Object.keys(DIRECTIONS);
  const results: { id: string; file: string; prompt: string }[] = [];
  await Promise.all(ids.flatMap((id) => Array.from({ length: VARIANTS }, async (_, v) => {
    const prompt = `${BRIEF}\n\nDirection: ${DIRECTIONS[id]}\n${PALETTES[v % PALETTES.length]}`;
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } } as any,
      });
      const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error('no image in response');
      const file = `${id}-${v + 1}.png`;
      fs.writeFileSync(path.join(outDir, file), Buffer.from(part.inlineData.data, 'base64'));
      results.push({ id, file, prompt });
      console.log('ok', file);
    } catch (err) {
      console.error('failed', id, v + 1, (err as Error).message);
    }
  })));

  results.sort((a, b) => a.file.localeCompare(b.file));
  const cards = results.map((r) => `<figure><img src="${r.file}" alt="${r.id}"><figcaption><b>${r.file.replace('.png', '')}</b><br>${DIRECTIONS[r.id]}</figcaption></figure>`).join('\n');
  fs.writeFileSync(path.join(outDir, 'contact-sheet.html'), `<!doctype html><meta charset="utf-8"><title>KolayXport logo concepts — ${round}</title>
<style>body{font:14px system-ui;margin:24px;background:#f8fafc}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}img{width:100%;border-radius:8px}figcaption{color:#475569;margin-top:8px}</style>
<h1>KolayXport logo concepts — ${round}</h1><p>Concept sketches from ${MODEL}. Final logo will be redrawn as SVG.</p><main>${cards}</main>`);
  fs.writeFileSync(path.join(outDir, 'prompts.json'), JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
