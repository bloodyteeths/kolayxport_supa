// lib/images/ownImage.ts — image bytes for any photo URL the editors hand to an AI tool. SERVER ONLY.
//
// Photos the seller has staged or uploaded but not yet sent to the marketplace are served by our own session-only
// endpoints, usually as RELATIVE URLs (`/api/etsy-drafts/media-preview?id=…`, `/api/clawd/serve-image?path=…`). The
// AI routes used to fetch only absolute public https URLs, so those references were dropped silently and the image
// was generated from text alone (tutorial bug report 2026-10-18). Our own URLs are read straight from disk here, with
// the same owner checks as the serving endpoints; anything else must be a public https image (SSRF-guarded).
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { isUnsafeUrl } from '@/lib/ai/safeUrl';
import { verifyImagePathSignature } from '@/lib/images/signedImageUrl';

export type OwnImage = { data: string; mimeType: string };

const MAX_BYTES = 8 * 1024 * 1024;
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const etsyDraftRoot = () => path.resolve(process.env.ETSY_DRAFT_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'etsy-drafts'));
const ebayImageRoot = () => path.resolve(process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images'));
const videoSourceRoot = () => path.resolve(process.env.AI_VIDEO_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ai-videos'), '_sources');

/** Our own hosts (relative URLs count as ours). Pure. */
function ownHosts(): string[] {
  return [process.env.NEXT_PUBLIC_BASE_URL, process.env.NEXTAUTH_URL, 'https://kolayxport.com']
    .map((u) => { try { return u ? new URL(u).host : ''; } catch { return ''; } })
    .filter(Boolean);
}

/** A URL the app itself serves → its path + query, or null for a foreign URL. Pure, exported for tests. */
export function ownPath(url: string): URL | null {
  try {
    if (url.startsWith('/') && !url.startsWith('//')) return new URL(url, 'https://own.invalid');
    const u = new URL(url);
    return ownHosts().includes(u.host) ? u : null;
  } catch {
    return null;
  }
}

async function readInside(root: string, file: string, mimeType?: string | null): Promise<OwnImage | null> {
  const abs = path.resolve(file);
  if (!abs.startsWith(root + path.sep)) return null;
  // Symlinks must not lead out of the root either: compare real paths.
  const [realRoot, realFile] = await Promise.all([fs.promises.realpath(root).catch(() => null), fs.promises.realpath(abs).catch(() => null)]);
  if (!realRoot || !realFile || !realFile.startsWith(realRoot + path.sep)) return null;
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat?.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return null;
  const type = mimeType && mimeType.startsWith('image/') ? mimeType : MIME[path.extname(abs).toLowerCase()];
  if (!type) return null;
  return { data: (await fs.promises.readFile(abs)).toString('base64'), mimeType: type };
}

/** One of our own photo URLs, for this seller only. */
async function loadOwn(userId: string, u: URL, depth: number): Promise<OwnImage | null> {
  const q = (k: string) => u.searchParams.get(k) || '';
  switch (u.pathname) {
    case '/api/etsy-drafts/media-preview': {
      const media = await prisma.etsyDraftMedia.findFirst({ where: { id: q('id'), draft: { userId } } });
      if (!media || media.kind === 'video') return null;
      if (media.localPath) return readInside(etsyDraftRoot(), media.localPath, media.contentType);
      return media.sourceUrl && depth < 1 ? loadImageForUser(userId, media.sourceUrl, depth + 1) : null;
    }
    case '/api/clawd/serve-image': {
      const p = q('path');
      if (!p) return null;
      const root = ebayImageRoot();
      const abs = path.resolve(root, p);
      // Same rule as the endpoint: the seller's own folder, or a valid signature (signed URLs are public anyway).
      const owner = path.relative(root, abs).split(path.sep)[0];
      if (owner !== userId && !verifyImagePathSignature(p, q('sig'))) return null;
      return readInside(root, abs);
    }
    case '/api/ai/video/source': {
      const id = q('id').replace(/[^a-f0-9]/g, '');
      if (!id) return null;
      const dir = path.join(videoSourceRoot(), userId.replace(/[^a-zA-Z0-9_-]/g, ''));
      const file = (await fs.promises.readdir(dir).catch(() => [] as string[])).find((f) => f.startsWith(`${id}.`));
      return file ? readInside(videoSourceRoot(), path.join(dir, file)) : null;
    }
    default: {
      // Static images the app itself serves from public/ (demo photos, marketing assets): public anyway, read from disk.
      if (!/\.(jpe?g|png|webp|gif)$/i.test(u.pathname)) return null;
      const pub = path.resolve(process.cwd(), 'public');
      return readInside(pub, path.resolve(pub, '.' + decodeURIComponent(u.pathname)));
    }
  }
}

/** Image bytes for a photo URL: our own (relative or absolute, owner-checked, read from disk) or public https. */
export async function loadImageForUser(userId: string | null, url: string, depth = 0): Promise<OwnImage | null> {
  if (!url || typeof url !== 'string') return null;
  const own = ownPath(url);
  if (own) return userId ? loadOwn(userId, own, depth).catch(() => null) : null;
  if (isUnsafeUrl(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!buf.length || buf.length > MAX_BYTES || !type.startsWith('image/')) return null;
    return { data: buf.toString('base64'), mimeType: type };
  } catch {
    return null;
  }
}

/** Is this a photo URL an AI tool can read for the seller (ours, relative or absolute, or public https)? Pure. */
export function isReadablePhotoUrl(url: string): boolean {
  const own = ownPath(url);
  if (own) return ['/api/etsy-drafts/media-preview', '/api/clawd/serve-image', '/api/ai/video/source'].includes(own.pathname);
  return !isUnsafeUrl(url);
}
