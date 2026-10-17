// lib/ai/videoDirector.ts — the Video Studio's "director": seller controls → the English prompt Veo performs best
// with (subject, action, camera, composition, ambiance, audio; Google's Veo prompt guide) + a negative prompt.
// ISOMORPHIC and pure (the studio shows the same text as a preview; tests cover it).

export const VIDEO_MODES = ['image', 'interpolate', 'reference'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const VIDEO_PRESETS = ['twirl', 'walk', 'pose', 'detail', 'hanger', 'flatlay', 'turntable', 'lifestyle', 'frontBack', 'custom'] as const;
export type VideoPreset = (typeof VIDEO_PRESETS)[number];

export const VIDEO_CAMERAS = ['auto', 'static', 'dollyIn', 'orbit', 'pan', 'craneDown', 'handheld'] as const;
export const VIDEO_MOTIONS = ['subtle', 'medium', 'lively'] as const;
export const VIDEO_EXPRESSIONS = ['smiling', 'joyful', 'natural', 'calm'] as const;
export const VIDEO_SCENES = ['keep', 'studio', 'garden', 'birthday', 'wedding', 'christmas', 'beach', 'home', 'custom'] as const;
export const VIDEO_LIGHTS = ['daylight', 'golden', 'studio', 'warm'] as const;
export const VIDEO_AUDIO = ['none', 'ambient', 'music'] as const;

export type VideoDirection = {
  mode: VideoMode;
  preset: VideoPreset;
  camera: (typeof VIDEO_CAMERAS)[number];
  motion: (typeof VIDEO_MOTIONS)[number];
  /** Is a person (model) in the photos? Drives the expression / realism lines. */
  person: boolean;
  expression: (typeof VIDEO_EXPRESSIONS)[number];
  scene: (typeof VIDEO_SCENES)[number];
  sceneText?: string;
  light: (typeof VIDEO_LIGHTS)[number];
  audio: (typeof VIDEO_AUDIO)[number];
  /** Free text from the seller (any language; Veo understands it). */
  notes?: string;
  /** Extra things to avoid, on top of the defaults. */
  avoid?: string;
  /** Product context (listing title), e.g. "dusty pink floral flower girl ball gown". */
  product?: string;
  /** Where it will be used (lib/ai/videoTargets) and the final format (1:1 / 4:5 are crops after generation). */
  target?: 'etsy' | 'ebay' | 'shopify' | 'amazon' | 'wix' | 'trendyol' | 'social';
  format?: '9:16' | '16:9' | '1:1' | '4:5';
};

export const DEFAULT_DIRECTION: VideoDirection = {
  mode: 'image', preset: 'twirl', camera: 'auto', motion: 'medium', person: true, expression: 'smiling',
  scene: 'keep', light: 'daylight', audio: 'none',
};

const PRESET_ACTION: Record<VideoPreset, { person: string; product: string }> = {
  twirl: {
    person: 'The model slowly twirls in place so the outfit is seen from every side; the skirt flares and settles naturally with the movement.',
    product: 'The garment turns slowly so it is seen from every side, the fabric moving naturally.',
  },
  walk: {
    person: 'The model walks a few natural steps toward the camera, then stops, poses and smiles, like a real fashion shoot.',
    product: 'The camera moves toward the product as if walking up to it, ending on a clean hero shot.',
  },
  pose: {
    person: 'The model stands naturally, shifts weight, gently touches the outfit and changes pose a few times like during a real photo shoot.',
    product: 'The product is presented in a calm hero shot with subtle natural movement.',
  },
  detail: {
    person: 'Close-up shots glide slowly across the outfit while it is worn, revealing fabric texture, stitching and embellishments in sharp detail.',
    product: 'A slow macro camera glide across the product reveals fabric texture, stitching and embellishments in sharp detail.',
  },
  hanger: {
    person: 'The outfit is shown on a hanger, moving gently in a soft breeze.',
    product: 'The garment hangs on its hanger and sways gently in a soft breeze; the fabric catches the light.',
  },
  flatlay: {
    person: 'Top-down view of the outfit laid flat; the camera slowly descends and rotates slightly to reveal details.',
    product: 'Top-down view of the product laid flat; the camera slowly descends and rotates slightly to reveal details.',
  },
  turntable: {
    person: 'The model turns slowly through a full circle as if on a turntable, showing the outfit from front, side and back.',
    product: 'The product rotates slowly through a full 360-degree turn on a turntable, showing every side.',
  },
  lifestyle: {
    person: 'A real candid moment: the model wears the outfit naturally and enjoys the setting, moving, laughing and playing as in real life.',
    product: 'The product is shown in a real lifestyle moment in the setting, naturally in use.',
  },
  frontBack: {
    person: 'A smooth, natural turn from the front view of the outfit to its back view, the model moving like a real person.',
    product: 'A smooth turn from the front view of the product to its back view.',
  },
  custom: { person: '', product: '' },
};

const CAMERA: Record<VideoDirection['camera'], string> = {
  auto: '',
  static: 'Locked-off static camera on a tripod.',
  dollyIn: 'Slow, smooth dolly-in toward the subject.',
  orbit: 'The camera slowly orbits around the subject.',
  pan: 'Slow, smooth lateral camera pan.',
  craneDown: 'Gentle crane shot descending from above to eye level.',
  handheld: 'Subtle handheld camera, like a real phone video.',
};

const MOTION: Record<VideoDirection['motion'], string> = {
  subtle: 'Calm, gentle, minimal movement.',
  medium: 'Natural, moderate movement.',
  lively: 'Lively, energetic, joyful movement.',
};

const EXPRESSION: Record<VideoDirection['expression'], string> = {
  smiling: 'a warm, genuine smile',
  joyful: 'a joyful, happy expression, laughing naturally',
  natural: 'a relaxed, natural expression with small genuine smiles',
  calm: 'a calm, serene, gentle expression',
};

const SCENE: Record<Exclude<VideoDirection['scene'], 'custom'>, string> = {
  keep: 'Keep the setting from the photo.',
  studio: 'Clean, bright white photo studio background.',
  garden: 'A lush flower garden.',
  birthday: 'A festive children\'s birthday party with balloons and a cake.',
  wedding: 'An elegant wedding venue with flowers.',
  christmas: 'A cozy Christmas living room with a decorated tree and soft lights.',
  beach: 'A sunny beach with soft sand and gentle waves.',
  home: 'A bright, cozy, modern home interior.',
};

const LIGHT: Record<VideoDirection['light'], string> = {
  daylight: 'Soft natural daylight.',
  golden: 'Warm golden-hour sunlight.',
  studio: 'Soft, even professional studio lighting.',
  warm: 'Warm, cozy indoor lighting.',
};

const AUDIO: Record<VideoDirection['audio'], string> = {
  none: '',
  ambient: 'Audio: soft natural ambient sound that matches the setting, no speech.',
  music: 'Audio: light, cheerful background music, no speech.',
};

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The full English prompt for Veo. `changes` are the follow-ups asked so far (oldest first). Pure. */
export function directVideo(d: VideoDirection, changes: string[] = []): string {
  const who = d.person ? 'person' : 'product';
  const product = clean(d.product, 160);
  const parts: string[] = [
    `Professional e-commerce product video${product ? ` for: ${product}` : ''}.`,
    d.mode === 'reference'
      ? 'Use the reference images: keep exactly the same product (design, colours, fabric, details) and, if shown, the same person.'
      : 'Keep the product exactly as in the photo: same design, colours, fabric and details' + (d.person ? ', and the same person.' : '.'),
    PRESET_ACTION[d.preset][who],
    CAMERA[d.camera],
    MOTION[d.motion],
  ];
  if (d.person) {
    parts.push(`The person looks alive and natural with ${EXPRESSION[d.expression]}, natural blinking, small natural head and hand movements, relaxed posture, realistic skin, hair and fabric motion. Never a frozen, blank or doll-like face.`);
  }
  parts.push(d.scene === 'custom' ? (clean(d.sceneText, 300) ? `Setting: ${clean(d.sceneText, 300)}.` : '') : SCENE[d.scene]);
  parts.push(LIGHT[d.light]);
  const notes = clean(d.notes, 800);
  if (notes) parts.push(notes);
  changes.map((c) => clean(c, 400)).filter(Boolean).forEach((c, i) => parts.push(`Change ${i + 1}: ${c}.`));
  parts.push('Photorealistic, the look of a real filmed video, smooth motion, sharp focus. No text, captions, logos or watermarks.');
  if (AUDIO[d.audio]) parts.push(AUDIO[d.audio]);
  return parts.filter(Boolean).join(' ');
}

/** What Veo should avoid (defaults + the seller's list). Pure. */
export function negativePrompt(d: Pick<VideoDirection, 'avoid' | 'person'>): string {
  const base = ['blurry', 'low quality', 'flicker', 'text', 'watermark', 'logo', 'changing the product design or colours'];
  if (d.person) base.push('distorted face', 'frozen expression', 'deformed hands', 'extra fingers', 'extra limbs');
  const extra = clean(d.avoid, 300);
  return [...base, ...(extra ? [extra] : [])].join(', ');
}

/** Normalises a direction payload from the client (unknown values → defaults). Pure. */
export function normalizeDirection(v: unknown): VideoDirection {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pick = <T extends readonly string[]>(list: T, x: unknown, def: T[number]): T[number] => (list.includes(x as string) ? (x as T[number]) : def);
  return {
    mode: pick(VIDEO_MODES, o.mode, DEFAULT_DIRECTION.mode),
    preset: pick(VIDEO_PRESETS, o.preset, DEFAULT_DIRECTION.preset),
    camera: pick(VIDEO_CAMERAS, o.camera, DEFAULT_DIRECTION.camera),
    motion: pick(VIDEO_MOTIONS, o.motion, DEFAULT_DIRECTION.motion),
    person: o.person === undefined ? DEFAULT_DIRECTION.person : Boolean(o.person),
    expression: pick(VIDEO_EXPRESSIONS, o.expression, DEFAULT_DIRECTION.expression),
    scene: pick(VIDEO_SCENES, o.scene, DEFAULT_DIRECTION.scene),
    sceneText: clean(o.sceneText, 300) || undefined,
    light: pick(VIDEO_LIGHTS, o.light, DEFAULT_DIRECTION.light),
    audio: pick(VIDEO_AUDIO, o.audio, DEFAULT_DIRECTION.audio),
    notes: clean(o.notes, 800) || undefined,
    avoid: clean(o.avoid, 300) || undefined,
    product: clean(o.product, 160) || undefined,
    target: (['etsy', 'ebay', 'shopify', 'amazon', 'wix', 'trendyol', 'social'] as const).find((x) => x === o.target),
    format: (['9:16', '16:9', '1:1', '4:5'] as const).find((x) => x === o.format),
  };
}
