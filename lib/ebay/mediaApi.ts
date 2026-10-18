// lib/ebay/mediaApi.ts — eBay Commerce Media API (video) client. SERVER ONLY.
//
// Official docs (checked 2026-10-18):
//  - createVideo  POST /video                  https://developer.ebay.com/api-docs/commerce/media/resources/video/methods/createVideo
//  - uploadVideo  POST /video/{id}/upload       https://developer.ebay.com/api-docs/commerce/media/resources/video/methods/uploadVideo
//  - getVideo     GET  /video/{id}              https://developer.ebay.com/api-docs/commerce/media/resources/video/methods/getVideo
//  - Server (OpenAPI spec https://developer.ebay.com/develop/api/spec/media_api.json): https://apim.ebay.com/commerce/media/v1_beta
//  - Scope: https://api.ebay.com/oauth/api_scope/sell.inventory (already requested by pages/api/integrations/ebay/connect.ts)
//  - Max 157,286,400 bytes (150 MB); classification ITEM only; the uploaded byte count must equal createVideo `size`.
//  - Status: PENDING_UPLOAD → PROCESSING → LIVE | PROCESSING_FAILED | BLOCKED. No delete method; an unused video
//    expires 30 days after upload (https://developer.ebay.com/api-docs/sell/static/inventory/managing-video-media.html).
//  - One video per listing (Inventory API Product.videoIds / InventoryItemGroup.videoIds note).
//
// Every network call goes through `deps.fetch` and every wait through `deps.sleep`, so tests never reach eBay.

import fs from 'fs';

export const EBAY_MEDIA_BASE = 'https://apim.ebay.com/commerce/media/v1_beta';
export const EBAY_VIDEO_MAX_BYTES = 157_286_400;
/** Upload formats eBay Seller Center lists (MP4, MOV). */
export const EBAY_VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
/** Default time a send waits for eBay to finish processing an uploaded video. */
export const EBAY_VIDEO_WAIT_MS = Number(process.env.EBAY_VIDEO_WAIT_MS) > 0 ? Number(process.env.EBAY_VIDEO_WAIT_MS) : 90_000;
const POLL_MS = 5_000;

export type EbayVideoStatus = 'PENDING_UPLOAD' | 'PROCESSING' | 'LIVE' | 'PROCESSING_FAILED' | 'BLOCKED' | string;

export interface EbayVideoInfo {
  videoId: string;
  status: EbayVideoStatus;
  statusMessage?: string;
  thumbnailUrl?: string;
  /** HLS playlist (plays natively on iPhone / Safari), else the first playlist. */
  playUrl?: string;
  expirationDate?: string;
}

/**
 * Typed Media API failure. `code`:
 *  - RECONNECT  401/403: the token lacks the scope or expired (reconnect eBay).
 *  - TOO_LARGE  over 150 MB.
 *  - REJECTED   eBay processed it to BLOCKED / PROCESSING_FAILED.
 *  - FAILED     anything else (HTTP error, missing id).
 */
export class EbayMediaError extends Error {
  constructor(readonly code: 'RECONNECT' | 'TOO_LARGE' | 'REJECTED' | 'FAILED', message: string, readonly status?: number) {
    super(message);
    this.name = 'EbayMediaError';
  }
}

export interface MediaDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function httpError(step: string, status: number, text: string): EbayMediaError {
  if (status === 401 || status === 403) return new EbayMediaError('RECONNECT', `eBay ${step} ${status}: ${text.slice(0, 200)}`, status);
  return new EbayMediaError('FAILED', `eBay ${step} ${status}: ${text.slice(0, 300)}`, status);
}

/** createVideo → the new video id (from the Location header). */
export async function createEbayVideo(token: string, input: { title: string; size: number; description?: string }, deps: MediaDeps = {}): Promise<string> {
  const f = deps.fetch ?? fetch;
  if (input.size > EBAY_VIDEO_MAX_BYTES) throw new EbayMediaError('TOO_LARGE', 'eBay videos can be at most 150 MB');
  const res = await f(`${EBAY_MEDIA_BASE}/video`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: (input.title || '').trim().slice(0, 80) || 'Product video',
      size: input.size,
      classification: ['ITEM'],
      ...(input.description ? { description: input.description.slice(0, 500) } : {}),
    }),
  });
  if (res.status !== 201) throw httpError('createVideo', res.status, await res.text().catch(() => ''));
  const videoId = (res.headers.get('location') || '').split('?')[0].split('/').filter(Boolean).pop();
  if (!videoId) throw new EbayMediaError('FAILED', 'eBay createVideo returned no video id');
  return videoId;
}

/** uploadVideo: the whole file in one request (Content-Length = createVideo size). */
export async function uploadEbayVideo(token: string, videoId: string, body: Uint8Array, deps: MediaDeps = {}): Promise<void> {
  const f = deps.fetch ?? fetch;
  const res = await f(`${EBAY_MEDIA_BASE}/video/${encodeURIComponent(videoId)}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw httpError('uploadVideo', res.status, await res.text().catch(() => ''));
}

/** getVideo → status, thumbnail and a playable URL. */
export async function getEbayVideo(token: string, videoId: string, deps: MediaDeps = {}): Promise<EbayVideoInfo> {
  const f = deps.fetch ?? fetch;
  const res = await f(`${EBAY_MEDIA_BASE}/video/${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw httpError('getVideo', res.status, await res.text().catch(() => ''));
  const j: any = await res.json().catch(() => ({}));
  const lists: Array<{ protocol?: string; playUrl?: string }> = Array.isArray(j?.playLists) ? j.playLists : [];
  const hls = lists.find((p) => String(p?.protocol).toUpperCase() === 'HLS') ?? lists[0];
  return {
    videoId: String(j?.videoId || videoId),
    status: String(j?.status || 'PROCESSING'),
    ...(j?.statusMessage ? { statusMessage: typeof j.statusMessage === 'string' ? j.statusMessage : JSON.stringify(j.statusMessage) } : {}),
    ...(j?.thumbnail?.imageUrl ? { thumbnailUrl: String(j.thumbnail.imageUrl) } : {}),
    ...(hls?.playUrl ? { playUrl: String(hls.playUrl) } : {}),
    ...(j?.expirationDate ? { expirationDate: String(j.expirationDate) } : {}),
  };
}

export type WaitResult = { state: 'live'; videoId: string } | { state: 'processing'; videoId: string };

/**
 * Polls getVideo until LIVE (→ live), BLOCKED / PROCESSING_FAILED (→ throws REJECTED) or `timeoutMs` passes
 * (→ processing: the caller keeps the video id and checks again on the next send). A failed poll counts as
 * "still processing" except 401/403 (RECONNECT).
 */
export async function waitForEbayVideo(token: string, videoId: string, opts: { timeoutMs?: number; intervalMs?: number } = {}, deps: MediaDeps = {}): Promise<WaitResult> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? EBAY_VIDEO_WAIT_MS;
  const intervalMs = opts.intervalMs ?? POLL_MS;
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      const info = await getEbayVideo(token, videoId, deps);
      if (info.status === 'LIVE') return { state: 'live', videoId };
      if (info.status === 'BLOCKED' || info.status === 'PROCESSING_FAILED') {
        throw new EbayMediaError('REJECTED', `eBay video ${info.status}${info.statusMessage ? `: ${info.statusMessage.slice(0, 200)}` : ''}`);
      }
    } catch (err) {
      if (err instanceof EbayMediaError && (err.code === 'REJECTED' || err.code === 'RECONNECT')) throw err;
    }
    if (now() + intervalMs > deadline) return { state: 'processing', videoId };
    await sleep(intervalMs);
  }
}

/** createVideo + uploadVideo for a local file. Returns the eBay video id (processing starts on eBay). */
export async function uploadEbayVideoFile(token: string, file: string, title: string, deps: MediaDeps = {}): Promise<string> {
  const buf = await fs.promises.readFile(file);
  if (buf.length > EBAY_VIDEO_MAX_BYTES) throw new EbayMediaError('TOO_LARGE', 'eBay videos can be at most 150 MB');
  const videoId = await createEbayVideo(token, { title, size: buf.length }, deps);
  await uploadEbayVideo(token, videoId, new Uint8Array(buf.buffer, buf.byteOffset, buf.length), deps);
  return videoId;
}
