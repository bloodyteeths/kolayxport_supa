import { describe, expect, it } from 'vitest';
import { directVideo, negativePrompt, normalizeDirection, DEFAULT_DIRECTION } from '@/lib/ai/videoDirector';
import { VIDEO_TARGET_PROFILES, generationAspect, videoReadiness } from '@/lib/ai/videoTargets';
import { ffmpegArgs, veoConstraints, veoRequest } from '@/lib/ai/video';

const img = { data: 'AAA', mimeType: 'image/jpeg' };

describe('video director', () => {
  it('a person gets a living, natural face; the product stays exact', () => {
    const p = directVideo({ ...DEFAULT_DIRECTION, person: true, expression: 'joyful', product: 'pink flower girl dress' });
    expect(p).toMatch(/pink flower girl dress/);
    expect(p).toMatch(/joyful/);
    expect(p).toMatch(/Never a frozen, blank or doll-like face/);
    expect(p).toMatch(/Keep the product exactly as in the photo/);
    expect(negativePrompt({ person: true })).toMatch(/frozen expression/);
  });
  it('product-only shots drop the person lines; follow-ups are numbered', () => {
    const p = directVideo({ ...DEFAULT_DIRECTION, person: false, preset: 'hanger' }, ['slower', 'closer']);
    expect(p).not.toMatch(/frozen/);
    expect(p).toMatch(/hanger/);
    expect(p).toMatch(/Change 1: slower\. Change 2: closer\./);
  });
  it('unknown client values fall back to defaults', () => {
    expect(normalizeDirection({ preset: 'x', camera: 'drone', target: 'etsy', format: '1:1' })).toMatchObject({ preset: 'twirl', camera: 'auto', target: 'etsy', format: '1:1' });
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

describe('ffmpeg edits', () => {
  it('square crop re-encodes; mute drops audio; trim sets start + length', () => {
    expect(ffmpegArgs('in', 'out', { square: true }).join(' ')).toMatch(/crop='min\(iw,ih\)'.*libx264/);
    expect(ffmpegArgs('in', 'out', { mute: true })).toContain('-an');
    const t = ffmpegArgs('in', 'out', { trimStart: 1, trimEnd: 6 });
    expect(t.slice(t.indexOf('-ss'), t.indexOf('-ss') + 2)).toEqual(['-ss', '1']);
    expect(t.slice(t.indexOf('-t'), t.indexOf('-t') + 2)).toEqual(['-t', '5']);
  });
});
