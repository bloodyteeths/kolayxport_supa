// lib/ai/videoTargets.ts — where the video will be used → its format, length, sound and resolution, and a readiness
// check against that marketplace's rules. ISOMORPHIC and pure.
//
// Sources (checked 2026-10-17): Etsy — 5–15 s, audio removed on upload, 1080p recommended, ≤100 MB, 2:1–1:2, square
// performs best; eBay — ≤60 s, ≤150 MB, MP4/AVC, ≤1080p; Shopify — file uploads ≤60 s, ≤1 GB, ≤4K; Amazon — 15–60 s
// recommended, ≥720p (1080p recommended), ≤500 MB; Wix — ≥7 s, Full HD. Trendyol publishes no video rule: a mobile-
// first default. Veo limits: 4/6/8 s per shot, +7 s per extension at 720p only.

export const VIDEO_TARGETS = ['etsy', 'ebay', 'shopify', 'amazon', 'wix', 'trendyol', 'social'] as const;
export type VideoTarget = (typeof VIDEO_TARGETS)[number];
export type VideoFormat = '9:16' | '16:9' | '1:1' | '4:5';

export type VideoTargetProfile = {
  format: VideoFormat;
  formats: VideoFormat[];
  durationSec: 4 | 6 | 8;
  /** Allowed total length on the marketplace. */
  minSec: number;
  maxSec: number;
  /** Recommended total length (extend to reach it when > 8 s). */
  idealSec: number;
  resolution: '720p' | '1080p' | '4k';
  minHeight: number;
  audio: 'none' | 'ambient' | 'music';
  /** The marketplace strips the sound (Etsy): sound controls are hidden. */
  audioRemoved: boolean;
  maxMB: number;
};

export const VIDEO_TARGET_PROFILES: Record<VideoTarget, VideoTargetProfile> = {
  etsy: { format: '1:1', formats: ['1:1', '4:5', '9:16', '16:9'], durationSec: 8, minSec: 5, maxSec: 15, idealSec: 8, resolution: '1080p', minHeight: 500, audio: 'none', audioRemoved: true, maxMB: 100 },
  ebay: { format: '16:9', formats: ['16:9', '1:1', '9:16'], durationSec: 8, minSec: 1, maxSec: 60, idealSec: 15, resolution: '1080p', minHeight: 720, audio: 'none', audioRemoved: false, maxMB: 150 },
  shopify: { format: '9:16', formats: ['9:16', '1:1', '4:5', '16:9'], durationSec: 8, minSec: 1, maxSec: 60, idealSec: 15, resolution: '1080p', minHeight: 720, audio: 'music', audioRemoved: false, maxMB: 1024 },
  amazon: { format: '16:9', formats: ['16:9', '1:1'], durationSec: 8, minSec: 1, maxSec: 60, idealSec: 15, resolution: '1080p', minHeight: 720, audio: 'music', audioRemoved: false, maxMB: 500 },
  wix: { format: '16:9', formats: ['16:9', '1:1', '9:16'], durationSec: 8, minSec: 7, maxSec: 60, idealSec: 8, resolution: '1080p', minHeight: 1080, audio: 'music', audioRemoved: false, maxMB: 1024 },
  trendyol: { format: '9:16', formats: ['9:16', '1:1', '4:5'], durationSec: 8, minSec: 5, maxSec: 30, idealSec: 8, resolution: '1080p', minHeight: 800, audio: 'none', audioRemoved: false, maxMB: 100 },
  social: { format: '9:16', formats: ['9:16', '1:1', '4:5'], durationSec: 8, minSec: 3, maxSec: 90, idealSec: 15, resolution: '1080p', minHeight: 1080, audio: 'music', audioRemoved: false, maxMB: 1024 },
};

/** Veo generates 16:9 or 9:16; square / 4:5 are centre crops of the matching orientation. Pure. */
/**
 * The video shape for a photo of width/height `ratio`: the marketplace's default when it fits the photo (≤15 % would
 * be cropped), else the allowed shape closest to the photo — a tall 3:4 photo in a square video needs padding at the
 * sides (it looked fake on production), in a 4:5 one it barely changes. Ties keep the marketplace's order. Pure.
 */
export function formatForPhoto(profile: { format: VideoFormat; formats: VideoFormat[] }, ratio: number | null | undefined): VideoFormat {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return profile.format;
  const value: Record<VideoFormat, number> = { '1:1': 1, '4:5': 0.8, '9:16': 9 / 16, '16:9': 16 / 9 };
  const loss = (f: VideoFormat) => (ratio > value[f] ? 1 - value[f] / ratio : 1 - ratio / value[f]);
  if (loss(profile.format) <= 0.15) return profile.format;
  const order = [profile.format, ...profile.formats.filter((f) => f !== profile.format)];
  return order.reduce((best, f) => (loss(f) < loss(best) - 0.01 ? f : best), order[0]);
}

export function generationAspect(format: VideoFormat, sourceLandscape: boolean): '9:16' | '16:9' {
  if (format === '16:9') return '16:9';
  if (format === '9:16') return '9:16';
  // 1:1 / 4:5: crop from the orientation of the photo so the product stays in frame.
  return sourceLandscape ? '16:9' : '9:16';
}

/** Output height in pixels for a resolution + format (Veo 720p = 1280×720 / 720×1280). Pure. */
export function outputHeight(resolution: string, format: VideoFormat): number {
  const short = resolution === '4k' ? 2160 : resolution === '1080p' ? 1080 : 720;
  const long = Math.round(short * 16 / 9);
  if (format === '16:9') return short;
  if (format === '9:16') return long;
  return short; // crops keep the short side (1:1 = short×short; 4:5 from 9:16 = short wide × 1.25·short high ≈ short+)
}

export type ReadinessIssue = { key: 'tooShort' | 'tooLong' | 'lowRes' | 'soundRemoved' | 'belowIdeal'; params?: Record<string, number> };

/** The video against the marketplace rules (errors first). Pure, exported for tests. */
export function videoReadiness(target: VideoTarget, v: { durationSec: number; resolution: string; format: VideoFormat; hasAudio: boolean }): { ok: boolean; issues: ReadinessIssue[] } {
  const p = VIDEO_TARGET_PROFILES[target];
  const issues: ReadinessIssue[] = [];
  if (v.durationSec < p.minSec) issues.push({ key: 'tooShort', params: { min: p.minSec } });
  if (v.durationSec > p.maxSec) issues.push({ key: 'tooLong', params: { max: p.maxSec } });
  if (outputHeight(v.resolution, v.format) < p.minHeight) issues.push({ key: 'lowRes', params: { min: p.minHeight } });
  const ok = issues.length === 0;
  if (p.audioRemoved && v.hasAudio) issues.push({ key: 'soundRemoved' });
  if (ok && v.durationSec < p.idealSec) issues.push({ key: 'belowIdeal', params: { ideal: p.idealSec } });
  return { ok, issues };
}
