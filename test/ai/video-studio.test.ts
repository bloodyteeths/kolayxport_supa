import { describe, expect, it } from 'vitest';
import { directVideo, negativePrompt, normalizeDirection, DEFAULT_DIRECTION } from '@/lib/ai/videoDirector';
import { VIDEO_TARGET_PROFILES, generationAspect, videoReadiness } from '@/lib/ai/videoTargets';
import { ffmpegArgs, finishArgs, veoConstraints, veoRequest } from '@/lib/ai/video';
import { keyframePrompt, matchWindow, normalizePhotoAnalysis, normalizeQa } from '@/lib/ai/videoProduct';

const img = { data: 'AAA', mimeType: 'image/jpeg' };

describe('video director', () => {
  it('reads as real footage: real-time speed, real skin, phone look; the product is locked to the photos, never described', () => {
    const p = directVideo({ ...DEFAULT_DIRECTION, person: true, expression: 'joyful', product: 'pink flower girl dress' });
    expect(p).toMatch(/pink flower girl dress/);
    expect(p).toMatch(/joyful/);
    expect(p).toMatch(/Never a frozen, blank or doll-like face/);
    expect(p).toMatch(/exactly the one in the photos in every frame/);
    expect(p).toMatch(/never slow motion/);
    expect(p).toMatch(/handheld footage/);
    expect(p).not.toMatch(/phone/i);
    expect(negativePrompt({ person: false })).toMatch(/camera app interface/);
    expect(p).toMatch(/no retouching or beauty filter/);
    const neg = negativePrompt({ person: true });
    expect(neg).toMatch(/frozen expression/);
    expect(neg).toMatch(/slow motion/);
    expect(neg).toMatch(/plastic or waxy skin/);
  });
  it('product-only shots drop the person lines; follow-ups are numbered', () => {
    const p = directVideo({ ...DEFAULT_DIRECTION, person: false, preset: 'hanger' }, ['slower', 'closer']);
    expect(p).not.toMatch(/frozen/);
    expect(p).toMatch(/hanger/);
    expect(p).toMatch(/Change 1: slower\. Change 2: closer\./);
  });
  it('studio and cinematic looks change the intro', () => {
    expect(directVideo({ ...DEFAULT_DIRECTION, look: 'studio' })).toMatch(/professional photographer/);
    expect(directVideo({ ...DEFAULT_DIRECTION, look: 'cinematic' })).toMatch(/cinema camera/);
  });
  it('unknown client values fall back to defaults; old modes map to today\'s', () => {
    expect(normalizeDirection({ preset: 'x', camera: 'drone', target: 'etsy', format: '1:1' })).toMatchObject({ preset: 'twirl', camera: 'auto', target: 'etsy', format: '1:1', look: 'phone', grain: true });
    expect(normalizeDirection({ mode: 'reference' }).mode).toBe('scene');
    expect(normalizeDirection({ mode: 'interpolate' }).mode).toBe('image');
  });
});

describe('product lock keyframes', () => {
  it('the end keyframe continues the first frame and shows the back after a twirl', () => {
    const p = keyframePrompt({ ...DEFAULT_DIRECTION, preset: 'twirl' }, { which: 'end', refCount: 4, hasStart: true });
    expect(p).toMatch(/Image 1 is the first frame/);
    expect(p).toMatch(/Images 2–5 are real photos/);
    expect(p).toMatch(/back of the outfit/);
    expect(p).toMatch(/Never add, remove, move or redesign/);
  });
  it('the start keyframe puts the product in the chosen scene', () => {
    const p = keyframePrompt({ ...DEFAULT_DIRECTION, scene: 'garden' }, { which: 'start', refCount: 3, hasStart: false });
    expect(p).toMatch(/Images 1–3/);
    expect(p).toMatch(/flower garden/);
  });
  it('an end photo taken from farther away is cropped so the model keeps her size', () => {
    // start: subject 10%–90% of the height; end: 30%–80% (smaller, farther away) → zoom 1.6×
    const w = matchWindow([100, 300, 900, 700], [300, 350, 800, 650], 1080, 1920)!;
    expect(w.height).toBe(Math.round(1920 / 1.6));
    expect(w.width).toBe(Math.round(1080 / 1.6));
    // feet line kept: end bottom (1536 px) maps to the start bottom (1728 px of 1920)
    expect(Math.round(((1536 - w.top) / w.height) * 1920)).toBe(1728);
    expect(matchWindow([100, 300, 900, 700], [110, 300, 905, 700], 1080, 1920)).toBeNull();
  });
  it('frames are picked automatically: full-body front starts, back ends, a close-up never anchors', () => {
    const photos = [
      { view: 'side', fullBody: true, person: true, quality: 8 },
      { view: 'front', fullBody: true, person: true, quality: 9 },
      { view: 'back', fullBody: true, person: true, quality: 8 },
      { view: 'detail', fullBody: false, person: true, quality: 9 },
    ];
    expect(normalizePhotoAnalysis({ photos, start: 2, end: 3 }, 4)).toMatchObject({ start: 1, end: 2 });
    // the model picked the close-up and no end: the rules fall back to the front and the back photo
    expect(normalizePhotoAnalysis([{ photos, start: 4, end: null }], 4)).toMatchObject({ start: 1, end: 2 });
    expect(normalizePhotoAnalysis(null, 2)).toMatchObject({ start: null, end: null });
  });
  it('quality check answers are clamped and cleaned', () => {
    expect(normalizeQa({ productMatch: 14, realism: '7', diffs: [{ text: 'hem flowers missing', fix: 'keep the hem flowers' }, { text: '' }], issues: 'x' }))
      .toEqual({ status: 'done', match: 10, realism: 7, diffs: [{ text: 'hem flowers missing', fix: 'keep the hem flowers' }], issues: [] });
    expect(normalizeQa(['garbled'])).toEqual({ status: 'failed' });
  });
});

describe('marketplace targets', () => {
  it('Etsy: silent, 1080p, square, 5–15 s', () => {
    expect(VIDEO_TARGET_PROFILES.etsy).toMatchObject({ audio: 'none', audioRemoved: true, resolution: '1080p', format: '1:1', minSec: 5, maxSec: 15 });
  });
  it('square / 4:5 are cropped from the photo orientation', () => {
    expect(generationAspect('1:1', true)).toBe('16:9');
    expect(generationAspect('4:5', false)).toBe('9:16');
    expect(generationAspect('16:9', false)).toBe('16:9');
  });
  it('readiness: Amazon recommends 15 s, Wix needs Full HD, Etsy flags sound', () => {
    expect(videoReadiness('amazon', { durationSec: 8, resolution: '1080p', format: '16:9', hasAudio: true }).issues.map((i) => i.key)).toEqual(['belowIdeal']);
    expect(videoReadiness('wix', { durationSec: 8, resolution: '720p', format: '16:9', hasAudio: true }).ok).toBe(false);
    expect(videoReadiness('etsy', { durationSec: 22, resolution: '1080p', format: '1:1', hasAudio: false }).issues[0].key).toBe('tooLong');
  });
});

describe('Veo request', () => {
  it('Vertex: allow_all, variants, audio flag, first + last frame', () => {
    const b = veoRequest({ mode: 'interpolate', prompt: 'p', image: img, lastFrame: img, aspectRatio: '9:16', durationSec: 6, resolution: '720p', quality: 'fast', variants: 3, audio: false, negativePrompt: 'blurry' }, 'vertex');
    expect(b.instances[0]).toMatchObject({ prompt: 'p', image: { bytesBase64Encoded: 'AAA' }, lastFrame: { bytesBase64Encoded: 'AAA' } });
    expect(b.parameters).toMatchObject({ personGeneration: 'allow_all', sampleCount: 3, generateAudio: false, durationSeconds: 6, negativePrompt: 'blurry' });
  });
  it('1080p / references force 8 s; extend is 720p with no duration', () => {
    expect(veoConstraints({ mode: 'image', durationSec: 4, resolution: '1080p' })).toEqual({ durationSec: 8, resolution: '1080p' });
    expect(veoConstraints({ mode: 'reference', durationSec: 4, resolution: '720p' }).durationSec).toBe(8);
    const ext = veoRequest({ mode: 'extend', prompt: 'p', video: { data: 'V', mimeType: 'video/mp4' }, aspectRatio: '9:16', durationSec: 7, resolution: '1080p', quality: 'fast' }, 'vertex');
    expect(ext.parameters.resolution).toBe('720p');
    expect(ext.parameters.durationSeconds).toBeUndefined();
    expect(ext.instances[0]).toHaveProperty('video');
  });
  it('reference mode sends up to 3 asset images', () => {
    const b = veoRequest({ mode: 'reference', prompt: 'p', references: [img, img, img, img], aspectRatio: '16:9', durationSec: 8, resolution: '720p', quality: 'best' }, 'vertex');
    expect((b.instances[0].referenceImages as unknown[]).length).toBe(3);
  });
});

describe('ffmpeg finish', () => {
  it('one pass: crop + grain re-encode, mute drops audio; nothing to do copies', () => {
    const a = finishArgs('in', 'out', { format: '1:1', grain: true, mute: true }).join(' ');
    expect(a).toMatch(/crop='min\(iw,ih\)'.*,noise=c0s=6:c0f=t\+u.*libx264/);
    expect(a).toMatch(/-an/);
    expect(finishArgs('in', 'out', { mute: true })).toEqual(expect.arrayContaining(['-c:v', 'copy', '-an']));
  });
});

describe('ffmpeg edits', () => {
  it('square crop re-encodes; mute drops audio; trim sets start + length', () => {
    expect(ffmpegArgs('in', 'out', { square: true }).join(' ')).toMatch(/crop='min\(iw,ih\)'.*libx264/);
    expect(ffmpegArgs('in', 'out', { mute: true })).toContain('-an');
    const t = ffmpegArgs('in', 'out', { trimStart: 1, trimEnd: 6 });
    expect(t.slice(t.indexOf('-ss'), t.indexOf('-ss') + 2)).toEqual(['-ss', '1']);
    expect(t.slice(t.indexOf('-t'), t.indexOf('-t') + 2)).toEqual(['-t', '5']);
  });
});
