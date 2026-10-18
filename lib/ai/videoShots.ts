// lib/ai/videoShots.ts — one recipe per Video Studio shot, made for THIS product. ISOMORPHIC and pure.
//
// Founder 2026-10-18: "each option should have its own prompt … you cannot give for every product the same prompt
// template … maybe the user is generating a flower bouquet video, or a book". So every shot (hero, orbit, 360°,
// detail, in use, with a person, light sweep, top-down) has its own camera, action, framing and things to avoid, and
// each is written for the product's profile: how it is used (worn / held / placed), how it behaves physically (rigid,
// fabric, organic, soft, liquid), printed text (a book cover must stay readable, pages must not flip into gibberish),
// shine, size, and its own visible details from the photos (lib/ai/videoProduct analyzePhotos). The analysis can also
// write the product's own action for a shot ("the bouquet stands in a glass vase on a dining table …").
//
// Rules learned from the checked production videos (2026-10-18, 20 videos, product match 5.3 / realism 4.8): small
// details are redrawn when things move (keep moves small and slow), hands break when they gesture (hands still or
// holding steadily), teeth break in open mouths (lips closed), faces break in profile, AI "next pose" end frames morph.

export const PRODUCT_USES = ['worn', 'held', 'placed'] as const;
export const PRODUCT_PHYSICS = ['rigid', 'fabric', 'organic', 'soft', 'liquid'] as const;
export const PRODUCT_SIZES = ['tiny', 'small', 'medium', 'large'] as const;
export const SHOT_KEYS = ['hero', 'orbit', 'turntable', 'detail', 'lifestyle', 'withPerson', 'reveal', 'flatlay'] as const;
export type ShotKey = (typeof SHOT_KEYS)[number];

/** What the video needs to know about the product (from the photos). */
export type ProductProfile = {
  /** Short English noun phrase from the photos, e.g. "bouquet of pink peonies", "hardcover cookbook". */
  name?: string;
  use: (typeof PRODUCT_USES)[number];
  physics: (typeof PRODUCT_PHYSICS)[number];
  /** Printed words, titles, labels or logos that must stay readable. */
  text?: boolean;
  /** Glass, metal, gems, gloss: highlights must move like real reflections. */
  shiny?: boolean;
  size?: (typeof PRODUCT_SIZES)[number];
  /** Lies flat naturally (a book, a card, a folded shirt, jewellery). */
  flat?: boolean;
  /** Up to 6 visible details of THIS product, English ("gold foil title on the cover", "cream ribbon around the stems"). */
  details?: string[];
  /** The exact words printed on the product, read from the photos (a book title, a label) — kept letter for letter. */
  printed?: string[];
  /** The analysis' own action for a shot, for this product (English, one sentence). */
  actions?: Partial<Record<ShotKey, string>>;
};

export type ShotPlan = {
  action: string;
  camera: string;
  framing: string;
  /** Shot-specific things to avoid (added to the negative prompt). */
  avoid: string[];
  /** Hands in the shot: 'none' (no hands at all), 'still' (a model wearing it), 'holding' (holding it steadily). */
  hands: 'none' | 'still' | 'holding';
  /** A person is in the frame. */
  person: boolean;
};

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Cleans a profile from the client or the analysis; legacy jobs (productKind only) get a sensible one. Pure. */
export function normalizeProfile(v: unknown, legacyKind?: 'worn' | 'object'): ProductProfile {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, any>;
  const pick = <T extends readonly string[]>(list: T, x: unknown): T[number] | undefined => (list.includes(x as string) ? (x as T[number]) : undefined);
  const use = pick(PRODUCT_USES, o.use) ?? (legacyKind === 'worn' ? 'worn' : 'placed');
  const physics = pick(PRODUCT_PHYSICS, o.physics) ?? (use === 'worn' ? 'fabric' : 'rigid');
  const details = (Array.isArray(o.details) ? o.details : []).map((x: unknown) => clean(x, 90)).filter(Boolean).slice(0, 6);
  const printed = (Array.isArray(o.printed) ? o.printed : []).map((x: unknown) => clean(x, 60).replace(/["“”]/g, '')).filter(Boolean).slice(0, 6);
  const actions: Partial<Record<ShotKey, string>> = {};
  if (o.actions && typeof o.actions === 'object') {
    for (const k of SHOT_KEYS) {
      const a = clean(o.actions[k], 300);
      if (a) actions[k] = a;
    }
  }
  return {
    name: clean(o.name, 80) || undefined, use, physics,
    text: o.text === true || undefined, shiny: o.shiny === true || undefined,
    size: pick(PRODUCT_SIZES, o.size), flat: o.flat === true || undefined,
    details: details.length ? details : undefined,
    printed: printed.length ? printed : undefined,
    actions: Object.keys(actions).length ? actions : undefined,
  };
}

const it = (p: ProductProfile) => (p.name ? `the ${p.name.replace(/^(the|a|an)\s+/i, '')}` : 'the product');

/** How the product behaves physically (and printed text / shine). Pure. */
export function physicsSentence(p: ProductProfile): string {
  const name = it(p);
  const parts: string[] = [];
  if (p.physics === 'rigid') parts.push(`${cap(name)} is one solid, rigid object: it never bends, stretches, melts or changes shape, and no part of it appears or disappears.`);
  if (p.physics === 'fabric') parts.push('The fabric moves with its real weight and settles naturally; its pattern, prints and embellishments stay fixed in place on the fabric.');
  if (p.physics === 'organic') parts.push('Every petal, leaf, stem and natural part stays attached with the same shape, colour and count; at most a slight, natural sway, nothing grows, wilts or opens.');
  if (p.physics === 'soft') parts.push(`${cap(name)} is soft but keeps its exact shape and proportions; nothing stretches, swells or changes.`);
  if (p.physics === 'liquid') parts.push('Any liquid moves with real physics and stays inside its container; the container itself is rigid.');
  if (p.text) parts.push('Every printed word, title, label and logo stays exactly as in the photos — the same letters, sharp and readable, never scrambled or rewritten; covers stay closed and pages are never flipped.');
  if (p.shiny) parts.push('Reflections and highlights move naturally with the camera and the light; the material keeps its exact colour and finish.');
  return parts.join(' ');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "These details stay exactly as in the photos" — the product's own details, never another product's words. Pure. */
export function detailLock(p: ProductProfile): string {
  const words = p.printed?.length ? ` The printed text stays letter for letter: ${p.printed.map((x) => `"${x}"`).join(', ')}.` : '';
  if (p.details?.length) {
    return `Keep these details exactly as in the photos in every frame: ${p.details.join('; ')} — the same shape, size, number, colour and place; nothing is added, removed or redrawn.${words}`;
  }
  return `Every visible detail of the product keeps exactly the same shape, size, number, colour and place in every frame; nothing is added, removed or redrawn.${words}`;
}

/** Camera distance by size (a ring is filmed close, a sofa from across the room). */
function distance(p: ProductProfile): string {
  if (p.size === 'tiny') return 'Filmed close like a macro product video, at a steady distance.';
  if (p.size === 'large') return 'Filmed from a few steps back so the whole piece fits comfortably in frame.';
  return '';
}

/** One plan per shot, for this product. `person` = a person is in the photos (wearing / holding it). Pure. */
export function shotPlan(key: ShotKey, p: ProductProfile, ctx: { person: boolean; addPerson?: boolean }): ShotPlan {
  const name = it(p);
  const own = p.actions?.[key];
  const inFrame = ctx.person || ctx.addPerson === true;
  const worn = p.use === 'worn';
  const held = p.use === 'held';
  const whole = `The whole of ${name}${inFrame && worn ? ' and the model\'s head' : ''} stays in frame from start to end; the camera never moves closer than the photos show.`;
  const hands: ShotPlan['hands'] = !inFrame ? 'none' : worn ? 'still' : 'holding';
  const noSpin = ['the product spinning or rotating by itself'];
  switch (key) {
    case 'hero':
      return {
        action: own ?? (inFrame
          ? worn ? `The model stands in a relaxed natural pose while the camera slowly pushes in to a sharp hero view of ${name}.`
            : `${cap(name)} is held steadily in front of them while the camera slowly pushes in to a sharp hero view of it.`
          : `${cap(name)} stays perfectly still where it is while the camera slowly pushes in from a slightly wider view to a sharp hero view.`),
        camera: 'A slow, smooth push-in on a stabilised camera, covering only about a tenth of the frame over the whole clip.',
        framing: [whole, distance(p)].filter(Boolean).join(' '),
        avoid: ['fast zoom', 'crash zoom', ...noSpin], hands, person: inFrame,
      };
    case 'orbit':
      return {
        action: own ?? `${cap(name)} stays perfectly still${inFrame ? ' and the model holds a calm pose' : ''} while the camera travels slowly in a gentle arc around it at the same height and distance.`,
        camera: p.text
          ? 'A small, very slow sideways arc of about 10 degrees, so the printed side keeps facing the camera and every letter stays still; the background shifts naturally behind (parallax).'
          : 'A very slow sideways arc of about 20 degrees at a steady speed, never further; the background shifts naturally behind the subject (parallax).',
        framing: [whole, distance(p)].filter(Boolean).join(' '),
        avoid: [...noSpin, 'background warping'], hands, person: inFrame,
      };
    case 'turntable':
      return {
        action: own ?? (inFrame && worn
          ? 'The model turns slowly on the spot at a steady, natural speed, showing the front, the side and the back.'
          : p.physics === 'organic'
            ? `${cap(name)} turns slowly on a turntable at a steady speed; it only sways very slightly as it turns.`
            : `${cap(name)} turns slowly on a turntable at a steady speed, as one piece, showing each side the photos show.`),
        camera: 'The camera stays perfectly still on a tripod.',
        framing: [whole, distance(p)].filter(Boolean).join(' '),
        avoid: ['wobbling', 'changing speed', 'camera movement'], hands: inFrame && worn ? 'still' : 'none', person: inFrame && worn,
      };
    case 'detail': {
      const focus = p.details?.[0];
      return {
        action: own ?? (focus ? `A slow macro glide across ${focus}, then the camera settles on it.` : `A slow macro glide across the most characteristic detail of ${name}, then the camera settles on it.`),
        camera: 'A slow, steady macro slide with a shallow depth of field.',
        framing: 'Close, but only on parts that a photo shows clearly; never a face or hands.',
        avoid: ['invented texture', 'blurry detail'], hands: 'none', person: false,
      };
    }
    case 'lifestyle':
      return {
        action: own ?? (inFrame && worn
          ? `The model wears ${name} in a real everyday setting, standing or walking a couple of calm steps.`
          : held
            ? `${cap(name)} lies on a table in a real everyday setting, among a few fitting everyday items that never cover it.`
            : `${cap(name)} stands in its natural place in a real home, with soft daylight changing gently over it.`),
        camera: 'A slow push-in with a slight sideways drift, so the background shifts naturally behind the product (parallax); no sudden moves.',
        framing: [`${cap(name)} stays the clear subject, fully visible and in focus.`, distance(p)].filter(Boolean).join(' '),
        avoid: ['clutter covering the product', 'other products that look like it', ...noSpin], hands: inFrame && worn ? 'still' : 'none', person: inFrame && worn,
      };
    case 'withPerson':
      return {
        action: own ?? (worn
          ? `A real person wears ${name} and poses calmly in a natural everyday moment, with a gentle weight shift.`
          : held
            ? `A real person holds ${name} steadily in both hands in front of them, shows it to the camera and tilts it slowly once.`
            : `A real person stands beside ${name}, rests a hand on it lightly for a moment, then lets go so it is fully visible.`),
        camera: 'A steady camera in front of them with a very slow push-in.',
        framing: `${cap(name)} stays the subject, fully visible and in focus; the person is natural and calm, never in a face close-up.`,
        avoid: ['hiding the product', 'the person covering the product'], hands: worn ? 'still' : 'holding', person: true,
      };
    case 'reveal':
      return {
        action: own ?? `The camera holds still while soft light glides slowly across ${name}, bringing out ${p.shiny ? 'its shine and finish' : p.physics === 'fabric' ? 'its texture and colour' : 'its shape, texture and colour'}.`,
        // Light alone looked like a filter over a still photo (bench: match 10, realism 5): a slight real move too.
        camera: 'An almost still camera with a very slight, slow push-in, so the depth of the scene reads as real; the light does the rest.',
        framing: [whole, distance(p)].filter(Boolean).join(' '),
        avoid: ['flashing light', 'strobe', 'lens flare', 'colour shift', ...noSpin], hands: inFrame ? (worn ? 'still' : 'holding') : 'none', person: inFrame,
      };
    case 'flatlay':
      return {
        action: own ?? (p.flat
          ? `Seen from directly above, ${name} lies flat on a clean surface; the camera lowers slowly toward it and turns a few degrees.`
          : `Seen from a high angle above, ${name} stands on a clean surface; the camera lowers slowly toward it.`),
        camera: 'A slow, smooth overhead move on a stabilised camera.',
        framing: [whole, distance(p)].filter(Boolean).join(' '),
        avoid: [...noSpin], hands: 'none', person: false,
      };
  }
}

/** How the person behaves, by what the hands do. Pure. */
export function personLine(hands: ShotPlan['hands'], expression: string): string {
  const face = `${expression} with the lips together, natural slow blinking, the face toward the camera (turning at most slightly, never to a side profile)`;
  const handLine = hands === 'holding'
    ? 'The hands hold the product steadily and calmly the whole time, the fingers relaxed and still around it; no gestures, no waving, no reaching, never touching the face or hair.'
    // Keep the first frame's pose: asking a photographed person to move their hands made Veo redraw them (bench 2026-10-18).
    : 'The hands and fingers stay completely still exactly where they are in the first frame the whole time; no hand gestures, no waving, no reaching, no touching the face or hair.';
  return `The person behaves like a real model at a photo shoot: ${face}, a relaxed posture with small natural weight shifts. ${handLine} `
    // Never "skin" / "body" words: Google refuses them next to a child model (lib/ai/videoDirector neutralPeople).
    + 'A natural, unretouched look with real texture and colour, natural hair, no beauty filter; never a frozen, blank or doll-like face.';
}
