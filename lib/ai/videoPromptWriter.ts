// lib/ai/videoPromptWriter.ts — an AI director writes every Veo prompt from what it actually sees. SERVER ONLY.
//
// Founder 2026-10-18: "the prompt to the video model needs an AI to generate it, according to the image and the
// user's preferences … you cannot just put static prompts, because you don't know what the user is generating … the AI
// can see what the product actually is by reading each product image … there can be billions of different products."
//
// So the vision model gets the exact first frame Veo starts from (and the end frame), every product photo, the shot's
// intent, the setting / look / marketplace and the seller's checked wishes, reads the product (what it is, its
// material, every visible detail, the printed words letter for letter, who wears or holds it) and writes the prompt
// for THIS product. What production taught us (lib/ai/videoShots header) goes in as hard rules, not as a template, and
// the deterministic prompt (lib/ai/videoDirector directVideo) stands in when the AI is unavailable.
import { aiJson } from './gemini';
import { shrink } from './videoSources';
import type { VideoMedia } from './video';
import { audioLine, EXPRESSION_TEXT, lookLines, neutralPeople, planFor, sceneSentence, type VideoDirection } from './videoDirector';
import { normalizeProfile } from './videoShots';

export type WrittenPrompt = { prompt: string; negative: string[]; reading: string };

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Safety pass over the AI's prompt. Filming-device words draw a camera-app screen; with a person in the frame, any
 * age / gender / body word gets the prompt refused by Google ("sensitive words", seen 2026-10-17). Pure, exported for tests.
 */
export function sanitizeWrittenPrompt(text: string, person: boolean): string {
  let t = clean(text, 2400)
    .replace(/\b(filmed|shot|recorded|captured)\s+(on|with)\s+(an?\s+)?(smart)?phone(\s+camera)?\b/gi, 'filmed handheld')
    .replace(/\b(smart)?phone\s+(video|footage|camera|recording)\b/gi, 'handheld footage')
    .replace(/\b(camera app|viewfinder|record button|on-screen (ui|interface|buttons?))\b/gi, '');
  if (!person) {
    // Nobody in the shot: words that imply a person filming bring hands into the frame (bench 2026-10-18).
    t = t.replace(/\b(hand[\s-]?held)\b/gi, 'steady').replace(/\s*(filmed|shot)\s+by\s+(the|a)\s+shop\s+owner\b/gi, '').replace(/\bshop owner\b/gi, 'shop');
  }
  if (person) {
    t = neutralPeople(t)
      .replace(/\b(wo)?men\b|\b(wo)?man\b|\bladies\b|\blady\b/gi, 'person')
      .replace(/\b(her|his)\b/gi, 'their')
      .replace(/\b(she|he)\b/gi, 'they')
      // Only the words Google flagged; product words ("off-the-shoulder flowers") stay.
      .replace(/\b(skin|body|bodies|chest|bare)\b/gi, 'look')
      .replace(/\blook\s+look\b/gi, 'look');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/** The AI's own extra negatives: short, plain, no people words when there is a person. Pure, exported for tests. */
export function cleanNegatives(list: unknown, person: boolean): string[] {
  return (Array.isArray(list) ? list : [])
    .map((x) => clean(x, 40).toLowerCase())
    .filter((x) => x && !/[.;:]/.test(x))
    .map((x) => (person ? sanitizeWrittenPrompt(x, true) : x))
    .filter(Boolean)
    .slice(0, 15);
}

/** Writes the Veo prompt for this product, these frames and this shot. Null when the AI cannot (use directVideo). */
export async function writeVideoPrompt(userId: string, input: {
  first: VideoMedia; last?: VideoMedia | null; products: VideoMedia[]; direction: VideoDirection; changes: string[]; durationSec: number;
}): Promise<WrittenPrompt | null> {
  const d = input.direction;
  const profile = normalizeProfile(d.profile, d.productKind);
  const plan = planFor(d, profile);
  const person = d.person || d.addPerson === true || plan.person;
  const look = lookLines(d);
  const [first, last, ...photos] = await Promise.all([
    shrink(input.first, 1024),
    input.last ? shrink(input.last, 1024) : Promise.resolve(null),
    ...input.products.slice(0, 4).map((m) => shrink(m, 768)),
  ]);
  const notes = clean(d.notesEn, 600) || '';
  const free = d.preset === 'custom' && !clean(d.shotText, 300);
  const shot = free ? (notes || 'a calm, simple product shot') : plan.action;
  const scene = d.scene === 'keep' ? 'the same place as the first frame (do not change the setting)' : sceneSentence(d);
  const lines = [
    'You are an expert product videographer. Write the prompt for Google Veo 3.1, an image-to-video model. The FIRST FRAME image is exactly where the video starts' + (last ? '; the LAST FRAME image is exactly where it must end' : '') + '. The PRODUCT PHOTOS show the same product from other views.',
    'First READ the images: what exactly the product is (any product — clothing, a book, a bouquet, a phone case, a candle, food, furniture, a toy …), its materials and how they behave (rigid, fabric, petals, soft, liquid), every visible detail that makes it recognisable, every printed word on it letter for letter, and whether a person wears or holds it.',
    `THE SHOT (adapt it to this product and these frames; if it does not physically suit the product, write the closest safe version): ${shot}${plan.camera ? ` Camera: ${plan.camera}` : ''}${plan.framing ? ` Framing: ${plan.framing}` : ''}`,
    `Look: ${look.intro} ${look.finish}`,
    `Setting: ${scene}. ${input.durationSec} seconds, one continuous shot.`,
    notes && !free ? `The seller's wishes (already checked, follow them): ${notes}` : '',
    input.changes.length ? `Changes asked after earlier takes (apply all, they win over the shot): ${input.changes.map((c, i) => `${i + 1}. ${clean(c, 300)}`).join(' ')}` : '',
    'HARD RULES (learned from checking real videos):',
    '- The product is exactly the one in the images in every frame: name its key visible details and say they keep their exact shape, size, number, colour and place; quote any printed words and say they stay letter for letter, sharp and readable. Never describe a change to the product.',
    '- Real footage at real-time speed, never slow motion; real weight and physics for its material; nothing morphs, melts, flickers, appears or disappears. Camera moves small and slow; the whole product stays in frame unless the shot is a detail shot of a part a photo shows.',
    '- Never turn an object to sides the photos do not show; never open, flip pages, unwrap or take the product apart.',
    '- Only states the FIRST FRAME already shows: if a wish needs a change of state the frame does not show (an unlit candle burning, a closed box open, a lamp switched on), leave that wish out — the video model then invents a hand doing it (a match lighting the candle appeared in every take on the bench). Nothing and nobody does anything to the product on camera.',
    '- Some gentle, real motion must be visible (a slow camera move with natural parallax, light or shadows shifting, a flame, leaves or fabric stirring slightly): a frozen image looks fake. Small printed text gets the smallest, slowest moves.',
    person
      ? `- The person: call them only "the model" or "the person" — no age, gender or body words (no girl, woman, child, skin, body). ${EXPRESSION_TEXT(d)} with lips together, natural slow blinking, the face toward the camera (never a side profile). The person keeps the pose of the first frame: the hands and fingers stay completely still exactly where they are in the first frame (redrawn hands are what breaks), ${plan.hands === 'holding' ? 'holding the product steadily' : 'never moving to the hips, the face or the hair'}; no gestures, no waving, no reaching; only blinking and tiny natural movements. Never a close-up of the face or hands.`
      : `- Nobody is in the shot: no people, hands, fingers${profile.use === 'worn' ? ', feet or legs' : ''} ever enter the frame; the product is never touched, picked up or moved. Never use the words "handheld" or "shop owner".`,
    '- Never write the words "phone" or "smartphone" about the camera or the footage (the model then draws a camera-app screen); if the product is a phone or phone accessory, call it "the mobile phone" with its screen dark.',
    '- No captions, subtitles, added text, logos or watermarks.',
    'Write 100–170 words, present tense, in this order: look, subject and setting as seen in the first frame, the action, the camera, framing, light, how it ends. Concrete and visual; no lists, no headings.',
    'Also return negative: up to 12 short things (2–4 words each) Veo must avoid for THIS product and shot; and reading: one English sentence of what you read the product to be.',
    'Return JSON: {"reading": string, "prompt": string, "negative": string[]}',
  ].filter(Boolean);
  const parts: any[] = [
    { text: 'FIRST FRAME:' }, { inlineData: { mimeType: first.mimeType, data: first.data } },
    ...(last ? [{ text: 'LAST FRAME:' }, { inlineData: { mimeType: last.mimeType, data: last.data } }] : []),
    ...(photos.length ? [{ text: `PRODUCT PHOTOS (${photos.length}):` }, ...photos.filter(Boolean).map((m) => ({ inlineData: { mimeType: m!.mimeType, data: m!.data } }))] : []),
    { text: lines.join('\n') },
  ];
  const raw = await aiJson<any>({ tier: 'deep', feature: 'video.prompt', userId, temperature: 0.4 }, parts).catch(() => null);
  const one = Array.isArray(raw) ? raw.find((x) => x && typeof x === 'object') : raw;
  const text = sanitizeWrittenPrompt(String(one?.prompt ?? ''), person);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 40 || words > 320) return null;
  const tail = ['No added captions, subtitles, logos or watermarks (keep the product\'s own text and logos as in the photos).', audioLine(d)].filter(Boolean).join(' ');
  return { prompt: `${text} ${tail}`.trim(), negative: cleanNegatives(one?.negative, person), reading: clean(one?.reading, 300) };
}
