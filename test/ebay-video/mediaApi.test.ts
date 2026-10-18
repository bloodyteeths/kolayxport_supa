// eBay Commerce Media API client (lib/ebay/mediaApi): createVideo → uploadVideo → poll getVideo until LIVE, with a
// mocked fetch and a fake clock. Never reaches eBay.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  EBAY_MEDIA_BASE,
  EBAY_VIDEO_MAX_BYTES,
  EbayMediaError,
  createEbayVideo,
  getEbayVideo,
  uploadEbayVideoFile,
  waitForEbayVideo,
} from '@/lib/ebay/mediaApi';

type Call = { url: string; init: RequestInit };

function scripted(responses: Array<(c: Call) => Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, init };
    calls.push(c);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next(c);
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const created = (id: string) => new Response(null, { status: 201, headers: { Location: `${EBAY_MEDIA_BASE}/video/${id}` } });

function clock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => { t += ms; }) };
}

function tempVideo(bytes = 1234) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kx-ebay-video-')), 'clip.mp4');
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
}

describe('createVideo', () => {
  it('posts title / size / classification ITEM and reads the id from Location', async () => {
    const s = scripted([() => created('v-1')]);
    const id = await createEbayVideo('tok', { title: 'Wooden Keepsake Box', size: 42 }, { fetch: s.fetch });
    expect(id).toBe('v-1');
    expect(s.calls[0].url).toBe(`${EBAY_MEDIA_BASE}/video`);
    expect(s.calls[0].init.method).toBe('POST');
    expect((s.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(s.calls[0].init.body))).toEqual({ title: 'Wooden Keepsake Box', size: 42, classification: ['ITEM'] });
  });
  it('refuses a file over 150 MB before calling eBay', async () => {
    const s = scripted([]);
    await expect(createEbayVideo('tok', { title: 't', size: EBAY_VIDEO_MAX_BYTES + 1 }, { fetch: s.fetch })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(s.calls).toHaveLength(0);
  });
  it('401 / 403 → RECONNECT (token without sell.inventory or expired)', async () => {
    const s = scripted([() => new Response('{"errors":[{"message":"Insufficient permissions"}]}', { status: 403 })]);
    await expect(createEbayVideo('tok', { title: 't', size: 1 }, { fetch: s.fetch })).rejects.toMatchObject({ name: 'EbayMediaError', code: 'RECONNECT', status: 403 });
  });
});

describe('create → upload → poll', () => {
  it('uploads the exact bytes as octet-stream and returns LIVE after PROCESSING', async () => {
    const file = tempVideo(1234);
    const s = scripted([
      () => created('v-9'),
      () => new Response(null, { status: 200 }),
      () => json({ videoId: 'v-9', status: 'PROCESSING' }),
      () => json({ videoId: 'v-9', status: 'LIVE', thumbnail: { imageUrl: 'https://i.ebayimg.com/t.jpg' } }),
    ]);
    const c = clock();
    const id = await uploadEbayVideoFile('tok', file, 'Box', { fetch: s.fetch });
    expect(id).toBe('v-9');
    const up = s.calls[1];
    expect(up.url).toBe(`${EBAY_MEDIA_BASE}/video/v-9/upload`);
    expect((up.init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
    expect((up.init.headers as Record<string, string>)['Content-Length']).toBe('1234');
    expect((up.init.body as Uint8Array).length).toBe(1234);
    expect(JSON.parse(String(s.calls[0].init.body)).size).toBe(1234);
    const r = await waitForEbayVideo('tok', id, { timeoutMs: 60_000, intervalMs: 5_000 }, { fetch: s.fetch, ...c });
    expect(r).toEqual({ state: 'live', videoId: 'v-9' });
    expect(c.sleep).toHaveBeenCalledTimes(1);
  });

  it('PROCESSING_FAILED / BLOCKED → REJECTED with eBay\'s status message', async () => {
    const s = scripted([() => json({ status: 'BLOCKED', statusMessage: 'Video contains prohibited content' })]);
    const err = await waitForEbayVideo('tok', 'v-2', { timeoutMs: 60_000 }, { fetch: s.fetch, ...clock() }).catch((e) => e);
    expect(err).toBeInstanceOf(EbayMediaError);
    expect(err.code).toBe('REJECTED');
    expect(err.message).toContain('prohibited');
    const s2 = scripted([() => json({ status: 'PROCESSING_FAILED' })]);
    await expect(waitForEbayVideo('tok', 'v-3', {}, { fetch: s2.fetch, ...clock() })).rejects.toMatchObject({ code: 'REJECTED' });
  });

  it('still PROCESSING when the wait ends → processing (keeps the id, no error)', async () => {
    const s = scripted(Array.from({ length: 10 }, () => () => json({ status: 'PROCESSING' })));
    const c = clock();
    const r = await waitForEbayVideo('tok', 'v-4', { timeoutMs: 20_000, intervalMs: 5_000 }, { fetch: s.fetch, ...c });
    expect(r).toEqual({ state: 'processing', videoId: 'v-4' });
    expect(s.calls.length).toBe(5);
    expect(c.now()).toBe(20_000);
  });

  it('a failed poll (5xx) counts as still processing; 403 while polling → RECONNECT', async () => {
    const s = scripted([() => new Response('oops', { status: 503 }), () => json({ status: 'LIVE' })]);
    await expect(waitForEbayVideo('tok', 'v-5', { timeoutMs: 60_000 }, { fetch: s.fetch, ...clock() })).resolves.toEqual({ state: 'live', videoId: 'v-5' });
    const s2 = scripted([() => new Response('no', { status: 403 })]);
    await expect(waitForEbayVideo('tok', 'v-6', {}, { fetch: s2.fetch, ...clock() })).rejects.toMatchObject({ code: 'RECONNECT' });
  });

  it('upload failure throws FAILED with the HTTP status', async () => {
    const file = tempVideo(10);
    const s = scripted([() => created('v-7'), () => new Response('size mismatch', { status: 400 })]);
    await expect(uploadEbayVideoFile('tok', file, 'Box', { fetch: s.fetch })).rejects.toMatchObject({ code: 'FAILED', status: 400 });
  });
});

describe('getVideo', () => {
  it('maps thumbnail and the HLS playlist', async () => {
    const s = scripted([() => json({
      videoId: 'v-8', status: 'LIVE', thumbnail: { imageUrl: 'https://i.ebayimg.com/t.jpg' },
      playLists: [{ protocol: 'DASH', playUrl: 'https://v/x.mpd' }, { protocol: 'HLS', playUrl: 'https://v/x.m3u8' }],
    })]);
    await expect(getEbayVideo('tok', 'v-8', { fetch: s.fetch })).resolves.toEqual({
      videoId: 'v-8', status: 'LIVE', thumbnailUrl: 'https://i.ebayimg.com/t.jpg', playUrl: 'https://v/x.m3u8',
    });
    expect(s.calls[0].url).toBe(`${EBAY_MEDIA_BASE}/video/v-8`);
  });
});
