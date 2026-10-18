// lib/ai/videoDirector.ts — the Video Studio's "director": seller controls → the English prompt Veo performs best
// with (look, subject, action, camera, scene, light, audio; Google's Veo prompt guide) + a negative prompt.
// ISOMORPHIC and pure (the studio shows the same text as a preview; tests cover it).
//
// KolayXport is a SaaS for every kind of seller (founder 2026-10-17: "you acted like this whole SaaS is for us"):
// every built-in shot and setting is product-neutral, and the studio adds AI-suggested shots and settings made for
// the seller's own product (lib/ai/videoProduct analyzePhotos → preset 'custom' + shotText).
//
// Founder 2026-10-17: "videos have to look natural … people hate AI videos … nobody should be able to tell". So every
// prompt asks for real footage: real-time speed (AI clips drift into slow motion), real fabric weight, real skin with
// no beauty filter, spontaneous small movements, and — by default — the look of a phone video filmed by the seller.
// The product is never described in words ("describing a dress is very difficult"): the lock sentence points Veo at the
// photos, and the frames themselves come from those photos (lib/ai/videoProduct).

import { detailLock, normalizeProfile, personLine, physicsSentence, shotPlan, SHOT_KEYS, type ProductProfile, type ShotKey, type ShotPlan } from './videoShots';

/** 'image': starts on a real photo (+ a real end photo → interpolate). 'scene': AI keyframes from all the photos. */
export const VIDEO_MODES = ['image', 'scene'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const VIDEO_PRESETS = ['hero', 'orbit', 'turntable', 'detail', 'lifestyle', 'withPerson', 'reveal', 'flatlay', 'twirl', 'walk', 'pose', 'frontBack', 'hanger', 'custom'] as const;
/**
 * The built-in shots: universal — they work for a dress, a phone case, shoes, flowers or a sculpture (founder: "video
 * options should be universal"). Product-specific shots (a twirl, a back-bow close-up …) come from the AI suggestions
 * made from the seller's own photos (lib/ai/videoProduct analyzePhotos). Older presets stay valid for old jobs.
 */
export const UNIVERSAL_PRESETS: readonly VideoPreset[] = ['hero', 'orbit', 'turntable', 'detail', 'lifestyle', 'withPerson', 'reveal', 'flatlay'];
export type VideoPreset = (typeof VIDEO_PRESETS)[number];

export const VIDEO_LOOKS = ['phone', 'studio', 'cinematic'] as const;
export const VIDEO_CAMERAS = ['auto', 'static', 'dollyIn', 'orbit', 'pan', 'craneDown', 'handheld'] as const;
export const VIDEO_MOTIONS = ['subtle', 'medium', 'lively'] as const;
export const VIDEO_EXPRESSIONS = ['smiling', 'joyful', 'natural', 'calm'] as const;
export const VIDEO_SCENES = ['keep', 'studio', 'home', 'outdoor', 'garden', 'birthday', 'wedding', 'christmas', 'beach', 'custom'] as const;
/** The settings every seller gets (the AI adds ones that suit the product; older values stay valid for old jobs). */
export const BASIC_SCENES: readonly (typeof VIDEO_SCENES)[number][] = ['keep', 'studio', 'home', 'outdoor'];
export const VIDEO_LIGHTS = ['daylight', 'golden', 'studio', 'warm'] as const;
export const VIDEO_AUDIO = ['none', 'ambient', 'music'] as const;

export type VideoDirection = {
  mode: VideoMode;
  preset: VideoPreset;
  /** How it is filmed: a real phone video (default, the least "AI" look), a studio shoot, or a cinematic film. */
  look: (typeof VIDEO_LOOKS)[number];
  camera: (typeof VIDEO_CAMERAS)[number];
  motion: (typeof VIDEO_MOTIONS)[number];
  /** Is a person (model) in the photos? Drives the expression / realism lines. */
  person: boolean;
  expression: (typeof VIDEO_EXPRESSIONS)[number];
  scene: (typeof VIDEO_SCENES)[number];
  sceneText?: string;
  light: (typeof VIDEO_LIGHTS)[number];
  audio: (typeof VIDEO_AUDIO)[number];
  /** Light film grain after generation (real camera sensors have it; clean AI output reads as fake). */
  grain: boolean;
  /** An AI-suggested shot for this product (preset 'custom'): what happens on camera, in English. */
  shotText?: string;
  /** The shot shows the product's back (a turn): the back photo becomes the end frame. */
  showsBack?: boolean;
  /** 'worn' (clothing, shoes, jewellery on a person) or 'object' — picks the lock wording. */
  productKind?: 'worn' | 'object';
  /** "With a person" on photos without one: AI adds a real-looking person using the product (keyframes). */
  addPerson?: boolean;
  /** What the photos show about the product (lib/ai/videoShots): each shot's recipe is written for it. */
  profile?: ProductProfile;
  /** Free text from the seller (any language). */
  notes?: string;
  /** The seller's notes as a checked English direction (server, lib/ai/videoNotes) — used instead of `notes`. */
  notesEn?: string;
  /** Extra things to avoid, on top of the defaults. */
  avoid?: string;
  /** Product context (listing title), e.g. "dusty pink floral flower girl ball gown". */
  product?: string;
  /** Where it will be used (lib/ai/videoTargets) and the final format (1:1 / 4:5 are crops after generation). */
  target?: 'etsy' | 'ebay' | 'shopify' | 'amazon' | 'wix' | 'trendyol' | 'social';
  format?: '9:16' | '16:9' | '1:1' | '4:5';
};

export const DEFAULT_DIRECTION: VideoDirection = {
  mode: 'image', preset: 'hero', look: 'phone', camera: 'auto', motion: 'subtle', person: true, expression: 'natural',
  scene: 'keep', light: 'daylight', audio: 'none', grain: true,
};

/** Shot types: small, physically plausible actions at real speed (big spins are where AI invents details). */
const PRESET_ACTION: Record<VideoPreset, { person: string; product: string }> = {
  turntable: {
    person: 'The model slowly turns through a full circle, showing the product from the front, the side and the back.',
    product: 'The product turns slowly through a full circle on a turntable as one rigid piece, showing every side.',
  },
  orbit: {
    person: 'The camera moves slowly in a gentle arc of about 30 degrees around the person, who stays relaxed and natural; the product stays the focus.',
    product: 'The product stays still while the camera moves slowly in a gentle arc of about 30 degrees around it, showing its shape and depth.',
  },
  withPerson: {
    person: 'A real person naturally wears, holds or uses the product in an everyday moment, with small natural movements; the product stays the focus and always clearly visible.',
    product: 'A real person naturally wears, holds or uses the product in an everyday moment, with small natural movements; the product stays the focus and always clearly visible.',
  },
  reveal: {
    person: 'Soft light glides slowly across the product while it is worn, revealing its texture and colour.',
    product: 'Soft light glides slowly across the still product, revealing its texture, finish and colour, as the camera holds steady.',
  },
  hero: {
    person: 'The model stands naturally while the camera moves gently in to a sharp hero shot, the whole product still in frame.',
    product: 'The camera moves gently in from a wide view to a sharp hero shot of the whole product, soft light gliding across its surface.',
  },
  detail: {
    person: 'Close-up shots glide slowly across the product while it is worn, showing its materials and details sharp and unchanged.',
    product: 'A slow close-up camera glide across the product shows its materials, finish and details sharp and unchanged.',
  },
  lifestyle: {
    person: 'A real, candid moment: the person uses or wears the product naturally in the setting, filmed as it happens.',
    product: 'The product in its natural place in a real everyday setting (on a table, a shelf, in a room or outdoors), with gentle natural movement of light and camera.',
  },
  flatlay: {
    person: 'Top-down view of the product laid flat; the camera slowly lowers and turns slightly.',
    product: 'Top-down view of the product laid flat; the camera slowly lowers and turns slightly.',
  },
  twirl: {
    person: 'The model turns around once at a natural, real-life speed so the product is seen from the side and the back; clothing moves and settles with its real weight.',
    product: 'The product turns slowly so it is seen from every side.',
  },
  walk: {
    person: 'The model walks a few natural steps toward the camera, stops and stands relaxed, like a real moment.',
    product: 'The camera walks up to the product and ends on a clean, steady shot.',
  },
  pose: {
    person: 'The model stands naturally, shifts weight, glances at the camera and away and touches the product lightly — a real person waiting to be photographed.',
    product: 'The product in a calm, steady shot with small natural movement.',
  },
  frontBack: {
    person: 'A smooth natural turn from the front of the product to its back, the model moving like a real person.',
    product: 'A smooth turn from the front of the product to its back.',
  },
  hanger: {
    person: 'The garment hangs on a hanger and moves gently in a soft breeze.',
    product: 'The garment hangs on its hanger and sways gently in a soft breeze; the fabric catches the light.',
  },
  custom: { person: '', product: '' },
};

const LOOK: Record<VideoDirection['look'], { intro: string; finish: string }> = {
  // Never the words "phone" / "smartphone": Veo then draws a camera-app screen (icons, shutter button) around the
  // shot — seen on production 2026-10-17. Describe how real handheld footage looks instead.
  // Not "filmed by the shop owner" / "hand-held" when nobody is in the shot: on the bench (2026-10-18) those words
  // brought a hand into the frame that picked up a sneaker, and feet stepping into it (realism 3/10).
  phone: {
    intro: 'Real, unedited footage of a real moment — it must look exactly like a real video, not like AI. The image fills the whole frame.',
    finish: 'Natural exposure and true-to-life colours, a calm, steady camera with only the faintest natural sway, real lens depth of field, natural motion blur on fast movement.',
  },
  studio: {
    intro: 'A real product video filmed by a professional photographer in a photo studio — real footage, not CGI or AI. The image fills the whole frame.',
    finish: 'Real camera exposure, accurate colours, crisp natural detail.',
  },
  cinematic: {
    intro: 'A real cinematic film shot on a cinema camera — real footage, not CGI or AI. The image fills the whole frame.',
    finish: 'Natural film look with shallow depth of field and gentle, real camera movement.',
  },
};

const CAMERA: Record<VideoDirection['camera'], string> = {
  auto: '',
  static: 'The camera stays still on a tripod.',
  dollyIn: 'The camera moves slowly and smoothly toward the subject.',
  orbit: 'The camera slowly moves around the subject.',
  pan: 'Slow, smooth sideways camera movement.',
  craneDown: 'The camera lowers gently from above to eye level.',
  handheld: 'Handheld, like a real phone video.',
};

const MOTION: Record<VideoDirection['motion'], string> = {
  subtle: 'Calm, small movements.',
  medium: 'Natural, moderate movement.',
  lively: 'Lively, joyful movement.',
};

const EXPRESSION: Record<VideoDirection['expression'], string> = {
  // Always closed lips: open mouths and laughs gave distorted teeth (production QA, 2026-10-18).
  smiling: 'a warm, genuine closed-lip smile',
  joyful: 'a bright, happy expression with a closed-lip smile',
  natural: 'a relaxed, natural expression with a soft closed-lip smile',
  calm: 'a calm, gentle expression',
};

const SCENE: Record<Exclude<VideoDirection['scene'], 'custom'>, string> = {
  keep: 'The same place as in the photos.',
  outdoor: 'A real outdoor setting in soft natural light.',
  studio: 'A clean, bright photo studio with a plain light background.',
  garden: 'A real flower garden.',
  birthday: 'A real children\'s birthday party at home with balloons and a cake.',
  wedding: 'A real wedding venue with flowers.',
  christmas: 'A cozy living room at Christmas with a decorated tree.',
  beach: 'A sunny beach with soft sand and gentle waves.',
  home: 'A bright, real, lived-in home.',
};

const LIGHT: Record<VideoDirection['light'], string> = {
  daylight: 'Soft natural daylight.',
  golden: 'Warm late-afternoon sunlight.',
  studio: 'Soft, even studio light.',
  warm: 'Warm indoor light.',
};

const AUDIO: Record<VideoDirection['audio'], string> = {
  none: '',
  ambient: 'Audio: soft natural ambient sound of the place, no speech, no music.',
  music: 'Audio: light, cheerful background music, no speech.',
};

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Words about who the model is ("girl", "child", "kız çocuk", "bebek") → "the model". Google's prompt filter rejects
 * prompts that mix them with body / skin words ("This prompt contains sensitive words", seen 2026-10-17 on a Turkish
 * "Kız Çocuk Elbisesi" title); the photos already show who it is. Pure, exported for tests.
 */
export function neutralPeople(text: string): string {
  return text
    .replace(/\bflower[\s-]+girls?\b/gi, 'formal')
    .replace(/\b(little|young|small)\s+(girl|boy|child|kid)s?\b/gi, 'the model')
    .replace(/\b(girls?|boys?|child(ren)?|kids?|toddlers?|bab(y|ies)|infants?|teen(ager)?s?|daughter|son)\b/gi, 'model')
    .replace(/(kız|erkek)\s+çocu[kğ]\w*/gi, '')
    .replace(/\b(kız|çocu[kğ]\w*|bebe[kğ]\w*|oğlan)\b/gi, '')
    .replace(/\bmodel\s+model\b/gi, 'model')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "The product is exactly the one in the photos" — an instruction, never a description. Pure. */
export function lockSentence(person: boolean, kind?: VideoDirection['productKind'], addPerson = false): string {
  // (No "body" / "skin" / "age" words for people: see neutralPeople.)
  const detail = kind === 'worn'
    ? 'the same cut, colours, fabric, pattern, prints and embellishments (same number, size and position), fastenings and length'
    : 'the same shape, proportions, colours, materials, textures, parts, buttons and any printed text or logos';
  return `The product must be exactly the one in the photos in every frame: ${detail}. Never add, remove, move or redesign any detail.`
    + (person && !addPerson ? ' Keep the same model exactly as in the photos: the same face, hair and look.' : '')
    + (addPerson ? ' The person is a natural-looking real adult; the product, not the person, is the subject.' : '');
}

/** How the person behaves (hands still, lips closed, face toward the camera; lib/ai/videoShots personLine). Pure. */
export function personSentence(d: Pick<VideoDirection, 'expression'> & { use?: ProductProfile['use'] }): string {
  return personLine(d.use && d.use !== 'worn' ? 'holding' : 'still', EXPRESSION[d.expression] ?? EXPRESSION.natural);
}

/** The look's opening and closing lines, and the audio line (for the AI prompt writer, lib/ai/videoPromptWriter). Pure. */
export function lookLines(d: Pick<VideoDirection, 'look'>): { intro: string; finish: string } {
  return LOOK[d.look] ?? LOOK.phone;
}
export function audioLine(d: Pick<VideoDirection, 'audio'>): string {
  return AUDIO[d.audio] ?? '';
}
export const EXPRESSION_TEXT = (d: Pick<VideoDirection, 'expression'>): string => EXPRESSION[d.expression] ?? EXPRESSION.natural;

export function sceneSentence(d: Pick<VideoDirection, 'scene' | 'sceneText' | 'light'>): string {
  const scene = d.scene === 'custom' ? (clean(d.sceneText, 300) ? `Setting: ${clean(d.sceneText, 300)}.` : '') : SCENE[d.scene];
  return [scene, LIGHT[d.light]].filter(Boolean).join(' ');
}

/**
 * The shot plan for a direction: a built-in shot → its own recipe for this product (lib/ai/videoShots); an AI-suggested
 * shot or the seller's own ("Free") → their action with the same product rules. Pure.
 */
export function planFor(d: VideoDirection, profile: ProductProfile = normalizeProfile(d.profile, d.productKind)): ShotPlan {
  if ((SHOT_KEYS as readonly string[]).includes(d.preset)) return shotPlan(d.preset as ShotKey, profile, { person: d.person, addPerson: d.addPerson });
  const who = d.person ? 'person' : 'product';
  const action = d.preset === 'custom' ? clean(d.shotText, 300) : PRESET_ACTION[d.preset][who];
  const worn = profile.use === 'worn';
  return {
    action,
    camera: '',
    framing: `The whole product${d.person && worn ? ' and the model\'s head' : ''} stays in frame for the whole shot: no extreme close-ups${d.person ? ' (never a close-up of the face or the hands)' : ''}, the camera never moves closer than the photos show, and any camera move stays small and slow.`,
    avoid: [],
    hands: !d.person ? 'none' : worn ? 'still' : 'holding',
    person: d.person,
  };
}

/** The full English prompt for Veo. `changes` are the follow-ups asked so far (oldest first). Pure. */
export function directVideo(d: VideoDirection, changes: string[] = [], opts: { safe?: boolean } = {}): string {
  const profile = normalizeProfile(d.profile, d.productKind);
  const plan = planFor(d, profile);
  const ppl = (t: string) => (d.person || plan.person ? neutralPeople(t) : t);
  const look = LOOK[d.look] ?? LOOK.phone;
  const lock = lockSentence(d.person && plan.person, profile.use === 'worn' ? 'worn' : 'object', d.addPerson === true);
  if (opts.safe) {
    // Google refused the wording once: the plainest prompt (no seller text, no AI text, no person details).
    const safe = shotPlan((SHOT_KEYS as readonly string[]).includes(d.preset) ? (d.preset as ShotKey) : 'hero', { use: profile.use, physics: profile.physics, text: profile.text }, { person: d.person });
    return [look.intro, lock, detailLock({ use: profile.use, physics: profile.physics }), safe.action, safe.camera, MOTION[d.motion], physicsSentence({ use: profile.use, physics: profile.physics, text: profile.text }),
      'Everything moves at real-time speed with real weight and physics; nothing morphs, melts or flickers.', sceneSentence(d),
      'No added captions, subtitles, logos or watermarks.'].filter(Boolean).join(' ');
  }
  const name = ppl(clean(profile.name, 80) || clean(d.product, 160));
  // "Free": the seller's own words are the shot.
  const notes = ppl(clean(d.notesEn, 600) || clean(d.notes, 800));
  const free = d.preset === 'custom' && !clean(d.shotText, 300) && notes;
  const parts: string[] = [
    look.intro,
    name ? `The product: ${name}.` : '',
    lock,
    detailLock(profile),
    free ? notes : ppl(plan.action),
    d.camera !== 'auto' ? CAMERA[d.camera] : plan.camera,
    plan.framing,
    MOTION[d.motion],
    plan.person ? personLine(plan.hands, EXPRESSION[d.expression] ?? EXPRESSION.natural) : '',
    physicsSentence(profile),
    'Everything moves at real-time speed, never slow motion, with real weight and physics; light and shadows stay consistent; nothing morphs, melts or flickers.',
    sceneSentence(d),
    look.finish,
  ];
  if (notes && !free) parts.push(notes);
  changes.map((c) => ppl(clean(c, 400))).filter(Boolean).forEach((c, i) => parts.push(`Change ${i + 1}: ${c}.`));
  parts.push('No added captions, subtitles, logos or watermarks (keep the product\'s own text and logos as in the photos).');
  if (AUDIO[d.audio]) parts.push(AUDIO[d.audio]);
  return parts.filter(Boolean).join(' ');
}

/** What Veo should avoid (defaults + the shot's own + the seller's list). Pure. */
export function negativePrompt(d: Partial<VideoDirection> & Pick<VideoDirection, 'person'>): string {
  const base = [
    'CGI', '3D render', 'animation', 'cartoon', 'illustration', 'painting', 'AI-generated look', 'video game',
    'slow motion', 'floaty or dreamlike motion', 'morphing', 'warping', 'melting', 'flickering details',
    'changing the product', 'changing the pattern or colours', 'added or missing details', 'extra accessories',
    'oversaturated colours', 'glow', 'haze', 'blurry', 'low quality', 'added captions', 'subtitles', 'watermark', 'added logos',
    'phone screen', 'camera app interface', 'on-screen buttons or icons', 'screen recording', 'black bars', 'letterbox', 'border', 'picture frame',
  ];
  const full = { ...DEFAULT_DIRECTION, ...d } as VideoDirection;
  const profile = normalizeProfile(full.profile, full.productKind);
  const plan = planFor(full, profile);
  base.push(...plan.avoid);
  if (profile.text) base.push('scrambled text', 'changed letters', 'flipping pages', 'opening the book');
  // No person in the shot: no hands reaching in to hold the product (seen on an eBay statue video).
  if (!plan.person && !full.person) {
    base.push('hands', 'fingers', 'people');
    // A worn product with nobody in the photos: Veo put feet stepping into a pair of sneakers (bench, 2026-10-18).
    if (profile.use === 'worn') base.push('feet', 'legs', 'someone putting it on', 'body parts');
  }
  if (plan.person || full.person) {
    base.push('plastic look', 'waxy look', 'airbrushed look', 'beauty filter', 'uncanny face', 'dead eyes', 'frozen expression', 'distorted face',
      'open mouth', 'visible teeth', 'talking', 'laughing', 'face in side profile', 'hand gestures', 'waving', 'reaching', 'clasped fingers',
      'hands near the face', 'deformed hands', 'extra fingers', 'fused fingers', 'extra limbs');
  }
  const extra = clean(full.avoid, 300);
  return Array.from(new Set([...base, ...(extra ? [extra] : [])])).join(', ');
}

/** Normalises a direction payload from the client (unknown values → defaults; legacy modes → today's). Pure. */
export function normalizeDirection(v: unknown): VideoDirection {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pick = <T extends readonly string[]>(list: T, x: unknown, def: T[number]): T[number] => (list.includes(x as string) ? (x as T[number]) : def);
  // Jobs made before 2026-10-18: 'interpolate' was its own mode (now: image + an end photo), 'reference' → 'scene'.
  const mode = o.mode === 'reference' ? 'scene' : o.mode === 'interpolate' ? 'image' : o.mode;
  return {
    mode: pick(VIDEO_MODES, mode, DEFAULT_DIRECTION.mode),
    preset: pick(VIDEO_PRESETS, o.preset, DEFAULT_DIRECTION.preset),
    look: pick(VIDEO_LOOKS, o.look, DEFAULT_DIRECTION.look),
    camera: pick(VIDEO_CAMERAS, o.camera, DEFAULT_DIRECTION.camera),
    motion: pick(VIDEO_MOTIONS, o.motion, DEFAULT_DIRECTION.motion),
    person: o.person === undefined ? DEFAULT_DIRECTION.person : Boolean(o.person),
    expression: pick(VIDEO_EXPRESSIONS, o.expression, DEFAULT_DIRECTION.expression),
    scene: pick(VIDEO_SCENES, o.scene, DEFAULT_DIRECTION.scene),
    sceneText: clean(o.sceneText, 300) || undefined,
    light: pick(VIDEO_LIGHTS, o.light, DEFAULT_DIRECTION.light),
    audio: pick(VIDEO_AUDIO, o.audio, DEFAULT_DIRECTION.audio),
    grain: o.grain === undefined ? DEFAULT_DIRECTION.grain : Boolean(o.grain),
    shotText: clean(o.shotText, 300) || undefined,
    showsBack: o.showsBack === true || undefined,
    addPerson: o.addPerson === true || undefined,
    productKind: o.productKind === 'worn' || o.productKind === 'object' ? o.productKind : undefined,
    profile: o.profile ? normalizeProfile(o.profile, o.productKind === 'worn' ? 'worn' : 'object') : undefined,
    notes: clean(o.notes, 800) || undefined,
    notesEn: clean(o.notesEn, 600) || undefined,
    avoid: clean(o.avoid, 300) || undefined,
    product: clean(o.product, 160) || undefined,
    target: (['etsy', 'ebay', 'shopify', 'amazon', 'wix', 'trendyol', 'social'] as const).find((x) => x === o.target),
    format: (['9:16', '16:9', '1:1', '4:5'] as const).find((x) => x === o.format),
  };
}
