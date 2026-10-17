// lib/ai/video.ts — AI product videos (Google Veo 3.1). SERVER ONLY.
//
// A video takes ~1 minute: start → long-running operation → poll → download the mp4 → store on the VPS.
// Two providers behind one interface:
//  - 'gemini' (GEMINI_API_KEY): works for product-only photos. Verified 2026-10-17: the Gemini API REFUSES input
//    photos showing a child ("can't create videos from input images containing photorealistic children"), even with
//    personGeneration 'allow_adult'; 'allow_all' is "currently not supported" there.
//  - 'vertex' (Google Cloud project, VERTEX_PROJECT + VERTEX_LOCATION + GOOGLE_APPLICATION_CREDENTIALS): Veo on
//    Vertex AI accepts personGeneration 'allow_all' for image-to-video once Google allowlists the project — the route
//    for kids' clothing shown on child models. Used automatically when configured.
import fs from 'fs';
import path from 'path';

export type VideoProvider = 'gemini' | 'vertex';
export type VideoStart = { operation: string; provider: VideoProvider; model: string };
export type VideoPoll =
  | { done: false }
  | { done: true; ok: true; videoUri?: string; videoBase64?: string; mimeType: string }
  | { done: true; ok: false; errorKey: 'videoChildPhoto' | 'videoFiltered' | 'videoFailed'; detail: string };

export const VIDEO_UPLOAD_ROOT = process.env.AI_VIDEO_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ai-videos');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function videoModel(quality: 'fast' | 'best'): string {
  if (quality === 'best') return process.env.VEO_MODEL || 'veo-3.1-generate-preview';
  return process.env.VEO_FAST_MODEL || 'veo-3.1-fast-generate-preview';
}

export function vertexConfigured(): boolean {
  return Boolean(process.env.VERTEX_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export function activeVideoProvider(): VideoProvider {
  return vertexConfigured() ? 'vertex' : 'gemini';
}

/** The text sent to Veo: the seller's description inside product-video rules. Pure, exported for tests. */
export function videoPrompt(description: string, changes: string[] = []): string {
  const clean = (s: string) => s.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [
    'Professional e-commerce product video for an online listing, made from the reference photo.',
    'Keep the product exactly as in the photo: same shape, colours, fabric, details and any person wearing it.',
    clean(description).slice(0, 1200),
    ...changes.map((c, i) => `Change ${i + 1}: ${clean(c).slice(0, 400)}`),
    'Smooth, realistic motion, soft natural light. No text, captions, logos or watermarks.',
  ];
  return parts.filter(Boolean).join(' ');
}

/** Veo's filter reasons → our error key. Pure, exported for tests. */
export function classifyVideoFilter(reasons: unknown): 'videoChildPhoto' | 'videoFiltered' {
  const text = Array.isArray(reasons) ? reasons.join(' ') : String(reasons ?? '');
  return /child|minor|kid/i.test(text) ? 'videoChildPhoto' : 'videoFiltered';
}

async function vertexToken(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  if (!t?.token) throw new Error('Vertex AI token unavailable');
  return t.token;
}

function vertexBase(model: string) {
  const loc = process.env.VERTEX_LOCATION || 'us-central1';
  return `https://${loc}-aiplatform.googleapis.com/v1/projects/${process.env.VERTEX_PROJECT}/locations/${loc}/publishers/google/models/${model}`;
}

export async function startVideo(input: {
  prompt: string;
  image: { data: string; mimeType: string };
  aspectRatio: '9:16' | '16:9';
  durationSec: 4 | 6 | 8;
  quality: 'fast' | 'best';
}): Promise<VideoStart> {
  const provider = activeVideoProvider();
  const model = videoModel(input.quality);
  const body = {
    instances: [{ prompt: input.prompt, image: { bytesBase64Encoded: input.image.data, mimeType: input.image.mimeType } }],
    parameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSec,
      // Gemini API: 'allow_adult' is the most it accepts for image-to-video. Vertex (allowlisted): 'allow_all'.
      personGeneration: provider === 'vertex' ? 'allow_all' : 'allow_adult',
      ...(provider === 'vertex' ? { sampleCount: 1 } : {}),
    },
  };
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
  // Gemini: generateVideoResponse.generatedSamples[].video.uri ; Vertex: videos[].gcsUri | bytesBase64Encoded
  const gemini = r.generateVideoResponse;
  if (gemini) {
    const sample = gemini.generatedSamples?.[0]?.video;
    if (sample?.uri) return { done: true, ok: true, videoUri: sample.uri, mimeType: 'video/mp4' };
    const reasons = gemini.raiMediaFilteredReasons;
    return { done: true, ok: false, errorKey: classifyVideoFilter(reasons), detail: String(Array.isArray(reasons) ? reasons[0] : 'filtered').slice(0, 300) };
  }
  const v = r.videos?.[0];
  if (v?.bytesBase64Encoded) return { done: true, ok: true, videoBase64: v.bytesBase64Encoded, mimeType: v.mimeType || 'video/mp4' };
  if (r.raiMediaFilteredReasons) {
    return { done: true, ok: false, errorKey: classifyVideoFilter(r.raiMediaFilteredReasons), detail: String(r.raiMediaFilteredReasons[0]).slice(0, 300) };
  }
  return { done: true, ok: false, errorKey: 'videoFailed', detail: 'no video in response' };
}

/** Downloads / decodes the finished video and stores it; returns the file path. */
export async function saveVideo(userId: string, jobId: string, result: Extract<VideoPoll, { ok: true }>): Promise<string> {
  let buf: Buffer;
  if (result.videoBase64) buf = Buffer.from(result.videoBase64, 'base64');
  else {
    const res = await fetch(result.videoUri as string, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Video download failed (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const dir = path.join(VIDEO_UPLOAD_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''));
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}.mp4`);
  await fs.promises.writeFile(file, buf);
  return file;
}
