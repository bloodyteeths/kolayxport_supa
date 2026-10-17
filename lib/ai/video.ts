// lib/ai/video.ts — AI product videos (Google Veo 3.1). SERVER ONLY.
//
// A video takes ~1–2 minutes: start → long-running operation → poll → save the mp4(s) on the VPS → post-process.
// Providers behind one interface:
//  - 'vertex' (Google Cloud project kolayxport-video; VERTEX_PROJECT + VERTEX_LOCATION + VERTEX_CREDENTIALS_FILE, a
//    service account with only the Agent Platform User role): personGeneration 'allow_all'. Verified 2026-10-17: it
//    makes the video from the founder's photo of a child model wearing the dress (88 s, the girl turns to show the
//    gown) — the route for kids' clothing. Used automatically when configured. Up to 4 variants per request.
//  - 'gemini' (GEMINI_API_KEY): fallback; refuses photos showing children; 1 video per request.
// Veo 3.1 modes: image→video ('image'), first + last frame ('interpolate'), up to 3 reference images ('reference',
// 8 s only), extend a Veo video by 7 s ('extend', 720p only). Image + reference images in one request is refused by Veo
// ("Image and reference images cannot be both set", tested 2026-10-17), so the product lock uses anchor frames and
// AI keyframes instead (lib/ai/videoProduct). Post-processing (ffmpeg on the VPS): `finishInPlace` (crop, mute,
// grain) for fresh videos, `editVideo` (crop, mute, trim) for the seller's edits.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

export type VideoProvider = 'gemini' | 'vertex';
export type VideoMedia = { data: string; mimeType: string };
export type VideoStart = { operation: string; provider: VideoProvider; model: string };
export type VideoResult = { videoUri?: string; videoBase64?: string; mimeType: string };
export type VideoPoll =
  | { done: false }
  | { done: true; ok: true; videos: VideoResult[] }
  | { done: true; ok: false; errorKey: 'videoChildPhoto' | 'videoFiltered' | 'videoFailed'; detail: string };

export const VIDEO_UPLOAD_ROOT = process.env.AI_VIDEO_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ai-videos');
export const VIDEO_SOURCE_ROOT = path.join(VIDEO_UPLOAD_ROOT, '_sources');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function vertexConfigured(): boolean {
  return Boolean(process.env.VERTEX_PROJECT && process.env.VERTEX_CREDENTIALS_FILE);
}

export function activeVideoProvider(): VideoProvider {
  return vertexConfigured() ? 'vertex' : 'gemini';
}

/** Vertex uses the GA model ids, the Gemini API the -preview ones. */
export function videoModel(quality: 'fast' | 'best', provider: VideoProvider = activeVideoProvider()): string {
  if (provider === 'vertex') return quality === 'best' ? (process.env.VEO_MODEL || 'veo-3.1-generate-001') : (process.env.VEO_FAST_MODEL || 'veo-3.1-fast-generate-001');
  return quality === 'best' ? 'veo-3.1-generate-preview' : 'veo-3.1-fast-generate-preview';
}

/** Veo's filter reasons → our error key. Pure, exported for tests. */
export function classifyVideoFilter(reasons: unknown): 'videoChildPhoto' | 'videoFiltered' {
  const text = Array.isArray(reasons) ? reasons.join(' ') : String(reasons ?? '');
  return /child|minor|kid/i.test(text) ? 'videoChildPhoto' : 'videoFiltered';
}

/** Veo 3.1 rules: 1080p / 4k and reference images need 8 s; extension is 720p only. Pure, exported for tests. */
export function veoConstraints(input: { mode: string; durationSec: number; resolution: string }): { durationSec: 4 | 6 | 8; resolution: '720p' | '1080p' | '4k' } {
  let resolution = (['720p', '1080p', '4k'].includes(input.resolution) ? input.resolution : '720p') as '720p' | '1080p' | '4k';
  if (input.mode === 'extend') resolution = '720p';
  let durationSec = ([4, 6, 8].includes(input.durationSec) ? input.durationSec : 8) as 4 | 6 | 8;
  if (resolution !== '720p' || input.mode === 'reference') durationSec = 8;
  return { durationSec, resolution };
}

async function vertexToken(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library');
  // Its own key file (not GOOGLE_APPLICATION_CREDENTIALS, which would change every other Google client in the app).
  const auth = new GoogleAuth({ keyFile: process.env.VERTEX_CREDENTIALS_FILE, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const t = await (await auth.getClient()).getAccessToken();
  if (!t?.token) throw new Error('Vertex AI token unavailable');
  return t.token;
}

function vertexBase(model: string) {
  const loc = process.env.VERTEX_LOCATION || 'us-central1';
  return `https://${loc}-aiplatform.googleapis.com/v1/projects/${process.env.VERTEX_PROJECT}/locations/${loc}/publishers/google/models/${model}`;
}

const media = (m: VideoMedia) => ({ bytesBase64Encoded: m.data, mimeType: m.mimeType });

export type StartVideoInput = {
  mode: 'image' | 'interpolate' | 'reference' | 'extend';
  prompt: string;
  negativePrompt?: string;
  image?: VideoMedia;
  lastFrame?: VideoMedia;
  references?: VideoMedia[];
  /** extend: the Veo video to continue */
  video?: VideoMedia;
  aspectRatio: '9:16' | '16:9';
  durationSec: number;
  resolution: string;
  quality: 'fast' | 'best';
  variants?: number;
  seed?: number | null;
  audio?: boolean;
};

/** The request body (exported for tests). */
export function veoRequest(input: StartVideoInput, provider: VideoProvider) {
  const { durationSec, resolution } = veoConstraints(input);
  const instance: Record<string, unknown> = { prompt: input.prompt };
  if (input.mode === 'extend' && input.video) instance.video = media(input.video);
  else if (input.mode === 'reference') instance.referenceImages = (input.references ?? []).slice(0, 3).map((r) => ({ image: media(r), referenceType: 'asset' }));
  else if (input.image) {
    instance.image = media(input.image);
    if (input.mode === 'interpolate' && input.lastFrame) instance.lastFrame = media(input.lastFrame);
  }
  const parameters: Record<string, unknown> = {
    aspectRatio: input.aspectRatio,
    resolution,
    personGeneration: provider === 'vertex' ? 'allow_all' : 'allow_adult',
  };
  if (input.mode !== 'extend') parameters.durationSeconds = durationSec;
  if (input.negativePrompt) parameters.negativePrompt = input.negativePrompt;
  if (typeof input.seed === 'number' && Number.isFinite(input.seed)) parameters.seed = Math.abs(Math.round(input.seed)) % 4294967295;
  if (provider === 'vertex') {
    parameters.sampleCount = Math.min(4, Math.max(1, Math.round(input.variants ?? 1)));
    parameters.generateAudio = Boolean(input.audio);
  }
  return { instances: [instance], parameters };
}

export async function startVideo(input: StartVideoInput): Promise<VideoStart> {
  const provider = activeVideoProvider();
  const model = videoModel(input.quality, provider);
  const body = veoRequest(input, provider);
  const url = provider === 'vertex' ? `${vertexBase(model)}:predictLongRunning` : `${GEMINI_BASE}/models/${model}:predictLongRunning`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'vertex') headers.Authorization = `Bearer ${await vertexToken()}`;
  else {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.name) throw new Error(`Veo start failed (${res.status}): ${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
  return { operation: String(json.name), provider, model };
}

export async function pollVideo(job: { operation: string; provider: string; model: string }): Promise<VideoPoll> {
  let json: any;
  if (job.provider === 'vertex') {
    const res = await fetch(`${vertexBase(job.model)}:fetchPredictOperation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await vertexToken()}` },
      body: JSON.stringify({ operationName: job.operation }),
    });
    json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Veo poll failed (${res.status})`);
  } else {
    const res = await fetch(`${GEMINI_BASE}/${job.operation}`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' } });
    json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Veo poll failed (${res.status})`);
  }
  if (!json?.done) return { done: false };
  if (json.error) return { done: true, ok: false, errorKey: 'videoFailed', detail: String(json.error.message || 'failed').slice(0, 300) };
  const r = json.response || {};
  const gemini = r.generateVideoResponse;
  const videos: VideoResult[] = gemini
    ? (gemini.generatedSamples ?? []).map((s: any) => s?.video?.uri).filter(Boolean).map((uri: string) => ({ videoUri: uri, mimeType: 'video/mp4' }))
    : (r.videos ?? []).filter((v: any) => v?.bytesBase64Encoded).map((v: any) => ({ videoBase64: v.bytesBase64Encoded, mimeType: v.mimeType || 'video/mp4' }));
  if (videos.length) return { done: true, ok: true, videos };
  const reasons = gemini?.raiMediaFilteredReasons ?? r.raiMediaFilteredReasons;
  if (reasons) return { done: true, ok: false, errorKey: classifyVideoFilter(reasons), detail: String(Array.isArray(reasons) ? reasons[0] : reasons).slice(0, 300) };
  return { done: true, ok: false, errorKey: 'videoFailed', detail: 'no video in response' };
}

export function userVideoDir(userId: string) {
  return path.join(VIDEO_UPLOAD_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''));
}

/** Downloads / decodes one finished video and stores it; returns the file path. */
export async function saveVideo(userId: string, jobId: string, result: VideoResult): Promise<string> {
  let buf: Buffer;
  if (result.videoBase64) buf = Buffer.from(result.videoBase64, 'base64');
  else {
    const res = await fetch(result.videoUri as string, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Video download failed (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const dir = userVideoDir(userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}.mp4`);
  await fs.promises.writeFile(file, buf);
  return file;
}

export type VideoEdit = { square?: boolean; portrait45?: boolean; mute?: boolean; trimStart?: number; trimEnd?: number };

/** ffmpeg arguments for an edit (exported for tests). */
export function ffmpegArgs(input: string, output: string, e: VideoEdit): string[] {
  const args = ['-y', '-v', 'error'];
  const start = typeof e.trimStart === 'number' && e.trimStart > 0 ? e.trimStart : 0;
  if (start) args.push('-ss', String(start));
  args.push('-i', input);
  if (typeof e.trimEnd === 'number' && e.trimEnd > start + 0.5) args.push('-t', String(e.trimEnd - start));
  const vf = e.square
    ? "crop='min(iw,ih)':'min(iw,ih)'"
    : e.portrait45
      ? "crop='if(gt(iw/ih,4/5),ih*4/5,iw)':'if(gt(iw/ih,4/5),ih,iw*5/4)'"
      : '';
  // Re-encode when cropping or trimming (frame-accurate cuts); otherwise copy the video stream.
  if (vf || start || e.trimEnd) args.push(...(vf ? ['-vf', vf] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
  else args.push('-c:v', 'copy');
  if (e.mute) args.push('-an');
  else args.push('-c:a', 'aac');
  args.push('-movflags', '+faststart', output);
  return args;
}

/** Applies an edit to a stored video; returns the new file path. */
export async function editVideo(userId: string, inputFile: string, newJobId: string, e: VideoEdit): Promise<string> {
  const dir = userVideoDir(userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${newJobId.replace(/[^a-zA-Z0-9_-]/g, '')}.mp4`);
  await run('ffmpeg', ffmpegArgs(inputFile, out, e), { timeout: 180_000 });
  return out;
}

/** ffmpeg arguments for finishing a fresh Veo video in one pass: crop to 1:1 / 4:5, mute, light film grain. Exported for tests. */
export function finishArgs(input: string, output: string, f: { mute?: boolean; format?: string; grain?: boolean }): string[] {
  const vf: string[] = [];
  if (f.format === '1:1') vf.push("crop='min(iw,ih)':'min(iw,ih)'");
  if (f.format === '4:5') vf.push("crop='if(gt(iw/ih,4/5),ih*4/5,iw)':'if(gt(iw/ih,4/5),ih,iw*5/4)'");
  // Real camera sensors have a little temporal noise; perfectly clean AI pixels read as fake. Luma only, light.
  if (f.grain) vf.push('noise=c0s=6:c0f=t+u');
  const args = ['-y', '-v', 'error', '-i', input];
  if (vf.length) args.push('-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p');
  else args.push('-c:v', 'copy');
  if (f.mute) args.push('-an');
  else args.push('-c:a', 'copy');
  args.push('-movflags', '+faststart', output);
  return args;
}

/**
 * Finishes a stored Veo video in place (marketplace format, sound, grain). Veo's untouched original is kept next to
 * it: extending needs a 16:9 / 9:16 Veo video without our processing.
 */
export async function finishInPlace(file: string, f: { mute?: boolean; format?: string; grain?: boolean }): Promise<void> {
  if (!f.mute && !f.grain && f.format !== '1:1' && f.format !== '4:5') return;
  const tmp = `${file}.fin.mp4`;
  await run('ffmpeg', finishArgs(file, tmp, f), { timeout: 240_000 });
  await fs.promises.rename(file, originalOf(file));
  await fs.promises.rename(tmp, file);
}

/** Where the uncropped Veo original of a cropped video is kept. */
export function originalOf(file: string): string {
  return `${file}.orig.mp4`;
}
