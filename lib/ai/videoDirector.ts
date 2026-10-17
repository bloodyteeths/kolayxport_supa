// lib/ai/videoDirector.ts — the Video Studio's "director": seller controls → the English prompt Veo performs best
// with (look, subject, action, camera, scene, light, audio; Google's Veo prompt guide) + a negative prompt.
// ISOMORPHIC and pure (the studio shows the same text as a preview; tests cover it).
//
// Founder 2026-10-17: "videos have to look natural … people hate AI videos … nobody should be able to tell". So every
// prompt asks for real footage: real-time speed (AI clips drift into slow motion), real fabric weight, real skin with
// no beauty filter, spontaneous small movements, and — by default — the look of a phone video filmed by the seller.
// The product is never described in words ("describing a dress is very difficult"): the lock sentence points Veo at the
// photos, and the frames themselves come from those photos (lib/ai/videoProduct).

/** 'image': starts on a real photo (+ a real end photo → interpolate). 'scene': AI keyframes from all the photos. */
export const VIDEO_MODES = ['image', 'scene'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const VIDEO_PRESETS = ['twirl', 'walk', 'pose', 'detail', 'hanger', 'flatlay', 'turntable', 'lifestyle', 'frontBack', 'custom'] as const;
export type VideoPreset = (typeof VIDEO_PRESETS)[number];

export const VIDEO_LOOKS = ['phone', 'studio', 'cinematic'] as const;
export const VIDEO_CAMERAS = ['auto', 'static', 'dollyIn', 'orbit', 'pan', 'craneDown', 'handheld'] as const;
export const VIDEO_MOTIONS = ['subtle', 'medium', 'lively'] as const;
export const VIDEO_EXPRESSIONS = ['smiling', 'joyful', 'natural', 'calm'] as const;
export const VIDEO_SCENES = ['keep', 'studio', 'garden', 'birthday', 'wedding', 'christmas', 'beach', 'home', 'custom'] as const;
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
  mode: 'image', preset: 'twirl', look: 'phone', camera: 'auto', motion: 'subtle', person: true, expression: 'natural',
  scene: 'keep', light: 'daylight', audio: 'none', grain: true,
};

/** Shot types: small, physically plausible actions at real speed (big spins are where AI invents details). */
const PRESET_ACTION: Record<VideoPreset, { person: string; product: string }> = {
  twirl: {
    person: 'The model turns around once at a natural, real-life speed so the outfit is seen from the side and the back, and the skirt swings and settles with its real weight.',
    product: 'The garment turns slowly so it is seen from every side, the fabric moving with its real weight.',
  },
  walk: {
    person: 'The model walks a few natural steps toward the camera, stops and stands relaxed, like a real moment filmed on a phone.',
    product: 'The camera walks up to the product and ends on a clean, steady shot.',
  },
  pose: {
    person: 'The model stands naturally, shifts weight, glances at the camera and away, touches the outfit lightly — a real person waiting to be photographed.',
    product: 'The product in a calm, steady shot with small natural movement of the fabric.',
  },
  detail: {
    person: 'Close-up shots glide slowly across the outfit while it is worn, showing the fabric, stitching and embellishments sharp and unchanged.',
    product: 'A slow close-up camera glide across the product shows the fabric, stitching and embellishments sharp and unchanged.',
  },
  hanger: {
    person: 'The outfit hangs on a hanger and moves gently in a soft breeze.',
    product: 'The garment hangs on its hanger and sways gently in a soft breeze; the fabric catches the light.',
  },
  flatlay: {
    person: 'Top-down view of the outfit laid flat; the camera slowly lowers and turns slightly.',
    product: 'Top-down view of the product laid flat; the camera slowly lowers and turns slightly.',
  },
  turntable: {
    person: 'The model slowly turns through a full circle, showing the outfit from the front, the side and the back.',
    product: 'The product turns slowly through a full circle on a turntable, showing every side.',
  },
  lifestyle: {
    person: 'A real, candid moment: the model wears the outfit and plays, laughs and moves naturally in the setting, filmed as it happens.',
    product: 'The product in a real lifestyle moment in the setting, naturally in use.',
  },
  frontBack: {
    person: 'A smooth natural turn from the front of the outfit to its back, the model moving like a real person.',
    product: 'A smooth turn from the front of the product to its back.',
  },
  custom: { person: '', product: '' },
};

const LOOK: Record<VideoDirection['look'], { intro: string; finish: string }> = {
  phone: {
    intro: 'A real, unedited smartphone video filmed by the shop owner — it must look exactly like real footage, not like AI.',
    finish: 'Natural phone-camera exposure and true-to-life colours, slight natural handheld micro-movement, real lens depth of field, natural motion blur on fast movement.',
  },
  studio: {
    intro: 'A real product video filmed by a professional photographer with a camera in a photo studio — real footage, not CGI or AI.',
    finish: 'Real camera exposure, accurate colours, crisp natural detail.',
  },
  cinematic: {
    intro: 'A real fashion film shot on a cinema camera — real footage, not CGI or AI.',
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
  smiling: 'a warm, genuine smile',
  joyful: 'a joyful, happy expression, laughing naturally',
  natural: 'a relaxed, natural expression with small genuine smiles',
  calm: 'a calm, gentle expression',
};

const SCENE: Record<Exclude<VideoDirection['scene'], 'custom'>, string> = {
  keep: 'The same place as in the photos.',
  studio: 'A clean, bright photo studio with a plain light background.',
  garden: 'A real flower garden.',
  birthday: 'A real children\'s birthday party at home with balloons and a cake.',
  wedding: 'A real wedding venue with flowers.',
  christmas: 'A cozy living room at Christmas with a decorated tree.',
  beach: 'A sunny beach with soft sand and gentle waves.',
  home: 'A bright, cozy, lived-in home.',
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

/** "The product is exactly the one in the photos" — an instruction, never a description. Pure. */
export function lockSentence(person: boolean): string {
  return 'The product must be exactly the one in the photos in every frame: the same cut, colours, fabric, pattern, lace and embroidery, flowers and appliqués (same number, size and position), sleeves, neckline, buttons, bows and length. Never add, remove, move or redesign any detail.'
    + (person ? ' Keep the same person: the same face, hair, skin tone, age and body.' : '');
}

/** How a real person behaves on camera. Pure. */
export function personSentence(d: Pick<VideoDirection, 'expression'>): string {
  return `The person behaves like a real person being filmed: ${EXPRESSION[d.expression]}, natural blinking, real breathing, small spontaneous head and hand movements, relaxed posture. Real skin texture with no retouching or beauty filter, natural hair, correct hands and fingers. Never a frozen, blank or doll-like face.`;
}

export function sceneSentence(d: Pick<VideoDirection, 'scene' | 'sceneText' | 'light'>): string {
  const scene = d.scene === 'custom' ? (clean(d.sceneText, 300) ? `Setting: ${clean(d.sceneText, 300)}.` : '') : SCENE[d.scene];
  return [scene, LIGHT[d.light]].filter(Boolean).join(' ');
}

/** The full English prompt for Veo. `changes` are the follow-ups asked so far (oldest first). Pure. */
export function directVideo(d: VideoDirection, changes: string[] = []): string {
  const who = d.person ? 'person' : 'product';
  const product = clean(d.product, 160);
  const look = LOOK[d.look] ?? LOOK.phone;
  const parts: string[] = [
    look.intro,
    product ? `The product: ${product}.` : '',
    lockSentence(d.person),
    PRESET_ACTION[d.preset][who],
    CAMERA[d.camera],
    MOTION[d.motion],
    d.person ? personSentence(d) : '',
    'Everything moves at real-time speed, never slow motion. Fabric moves with its real weight, folds and physics; light and shadows stay consistent; nothing morphs, melts or flickers.',
    sceneSentence(d),
    look.finish,
  ];
  const notes = clean(d.notes, 800);
  if (notes) parts.push(notes);
  changes.map((c) => clean(c, 400)).filter(Boolean).forEach((c, i) => parts.push(`Change ${i + 1}: ${c}.`));
  parts.push('No text, captions, logos or watermarks.');
  if (AUDIO[d.audio]) parts.push(AUDIO[d.audio]);
  return parts.filter(Boolean).join(' ');
}

/** What Veo should avoid (defaults + the seller's list). Pure. */
export function negativePrompt(d: Pick<VideoDirection, 'avoid' | 'person'>): string {
  const base = [
    'CGI', '3D render', 'animation', 'cartoon', 'illustration', 'painting', 'AI-generated look', 'video game',
    'slow motion', 'floaty or dreamlike motion', 'morphing', 'warping', 'melting', 'flickering details',
    'changing the product', 'changing the pattern or colours', 'added or missing details', 'extra accessories',
    'oversaturated colours', 'glow', 'haze', 'blurry', 'low quality', 'text', 'watermark', 'logo',
  ];
  if (d.person) base.push('plastic or waxy skin', 'airbrushed skin', 'beauty filter', 'uncanny face', 'dead eyes', 'frozen expression', 'distorted face', 'deformed hands', 'extra fingers', 'extra limbs');
  const extra = clean(d.avoid, 300);
  return [...base, ...(extra ? [extra] : [])].join(', ');
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
    notes: clean(o.notes, 800) || undefined,
    avoid: clean(o.avoid, 300) || undefined,
    product: clean(o.product, 160) || undefined,
    target: (['etsy', 'ebay', 'shopify', 'amazon', 'wix', 'trendyol', 'social'] as const).find((x) => x === o.target),
    format: (['9:16', '16:9', '1:1', '4:5'] as const).find((x) => x === o.format),
  };
}
